import { NextResponse } from "next/server"
import fetch from "node-fetch"
import * as cheerio from "cheerio"
import semver from "semver"

interface Plugin {
  name: string;
  version: string;
  latestVersion?: string;
  isUpToDate?: boolean;
  versionDetected: boolean;
}

interface Theme {
  name: string;
  version: string | null;
  isChild: boolean;
  parentTheme?: string;
}

async function getLatestPluginVersion(pluginSlug: string): Promise<string | null> {
  try {
    const response = await fetch(`https://api.wordpress.org/plugins/info/1.0/${pluginSlug}.json`)
    if (!response.ok) return null
    const data = await response.json() as { version?: string }
    return data?.version || null
  } catch {
    return null
  }
}

function normalizePluginSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-') // Replace non-alphanumeric chars with hyphens
    .replace(/-+/g, '-')         // Replace multiple hyphens with single
    .replace(/^-|-$/g, '');      // Remove leading/trailing hyphens
}

// Add these patterns for premium plugin detection
const PREMIUM_PLUGIN_PATTERNS = [
  {
    name: 'RevSlider',
    patterns: [
      /revslider\/public\/assets\/js\/rs6\.min\.js\?ver=([0-9.]+)/,
      /revslider\/public\/assets\/css\/rs6\.css\?ver=([0-9.]+)/,
      /\/plugins\/revslider\/.*?ver=([0-9.]+)/,
      /"revSliderVersion":"([0-9.]+)"/,
    ]
  },
  {
    name: 'WPBakery Page Builder',
    patterns: [
      /js_composer\/assets\/js\/dist\/js_composer_front\.min\.js\?ver=([0-9.]+)/,
      /js_composer\/assets\/css\/js_composer\.min\.css\?ver=([0-9.]+)/,
      /"vcVersion":"([0-9.]+)"/,
    ]
  },
  {
    name: 'Advanced Custom Fields Pro',
    patterns: [
      /advanced-custom-fields-pro\/assets\/build\/js\/acf\.min\.js\?ver=([0-9.]+)/,
      /advanced-custom-fields-pro\/assets\/build\/css\/acf\.min\.css\?ver=([0-9.]+)/,
    ]
  },
  {
    name: 'Elementor Pro',
    patterns: [
      /elementor-pro\/assets\/js\/frontend\.min\.js\?ver=([0-9.]+)/,
      /elementor-pro\/assets\/css\/frontend\.min\.css\?ver=([0-9.]+)/,
    ]
  }
];

function createPlugin(name: string, version: string | null): Plugin {
  return {
    name,
    version: version || "Unknown",
    versionDetected: version !== null && version !== "Unknown"
  };
}

function detectPremiumPlugins($: cheerio.CheerioAPI, html: string): Plugin[] {
  const premiumPlugins: Plugin[] = [];
  
  PREMIUM_PLUGIN_PATTERNS.forEach(({ name, patterns }) => {
    if (premiumPlugins.some(p => p.name.toLowerCase() === name.toLowerCase())) {
      return;
    }

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        premiumPlugins.push(createPlugin(name, match[1]));
        break;
      }
    }
  });

  // Check for inline scripts that might contain version info
  $('script').each((_, elem) => {
    const scriptContent = $(elem).html() || '';
    PREMIUM_PLUGIN_PATTERNS.forEach(({ name, patterns }) => {
      if (!premiumPlugins.some(p => p.name === name)) {
        for (const pattern of patterns) {
          const match = scriptContent.match(pattern);
          if (match) {
            premiumPlugins.push(createPlugin(name, match[1]));
            break;
          }
        }
      }
    });
  });

  return premiumPlugins;
}

// Add this function near the other helper functions
async function scanPluginDirectory(baseUrl: string): Promise<Plugin[]> {
  const plugins: Plugin[] = [];
  try {
    // Try to list the plugins directory
    const response = await fetch(`${baseUrl}/wp-content/plugins/`)
    if (!response.ok) return plugins;

    const html = await response.text()
    const $ = cheerio.load(html)

    // Look for directory listings
    $('a, td a').each((_, elem) => {
      const href = $(elem).attr('href') || ''
      const text = $(elem).text().trim()
      
      // Common directory listing patterns
      if (
        (href.endsWith('/') || text.endsWith('/')) && 
        !href.includes('..') && 
        !['Parent Directory', '..', '.'].includes(text)
      ) {
        const pluginName = href.replace(/\/$/, '') || text.replace(/\/$/, '')
        if (pluginName && !plugins.some(p => p.name === pluginName)) {
          plugins.push(createPlugin(pluginName, null))
        }
      }
    })

    // Also try to read readme.txt or readme.md files for each found plugin
    await Promise.all(
      plugins.map(async (plugin) => {
        try {
          const readmeResponse = await fetch(`${baseUrl}/wp-content/plugins/${plugin.name}/readme.txt`)
          if (readmeResponse.ok) {
            const readmeText = await readmeResponse.text()
            const versionMatch = readmeText.match(/Stable tag:\s*([0-9.]+)/) ||
                               readmeText.match(/Version:\s*([0-9.]+)/)
            if (versionMatch) {
              plugin.version = versionMatch[1]
              plugin.versionDetected = true
            }
          }
        } catch {
          // Silently fail if readme.txt is not accessible
        }
      })
    )
  } catch {
    // Silently fail if directory listing is not enabled
  }
  return plugins
}

// Add this function to detect theme
function detectTheme($: cheerio.CheerioAPI, html: string): Theme | null {
  let theme: Theme | null = null;

  // Method 1: Check style.css links
  $('link[rel="stylesheet"]').each((_, elem) => {
    const href = $(elem).attr('href') || ''
    const themeMatch = href.match(/\/wp-content\/themes\/([^/]+)/)
    if (themeMatch) {
      const name = themeMatch[1]
      const versionMatch = href.match(/\?ver=([0-9.]+)/)
      
      theme = {
        name,
        version: versionMatch?.[1] || null,
        isChild: false
      }
    }
  })

  // Method 2: Check meta tags
  const themeMetaTag = $('meta[name="template"]').attr('content') ||
                      $('meta[name="generator"]').attr('content')
  if (themeMetaTag) {
    const themeMatch = themeMetaTag.match(/theme:\s*([^,\s]+)/i)
    if (themeMatch) {
      theme = theme || {
        name: themeMatch[1],
        version: null,
        isChild: false
      }
    }
  }

  // Method 3: Check for child theme
  if (theme) {
    const parentThemeLink = $('link[rel="stylesheet"][href*="/wp-content/themes/"]').filter((_, elem) => {
      const href = $(elem).attr('href') || ''
      return href.includes('/themes/') && !href.includes(`/themes/${theme?.name}/`)
    })

    if (parentThemeLink.length) {
      const parentMatch = parentThemeLink.attr('href')?.match(/\/themes\/([^/]+)/)
      if (parentMatch) {
        theme.isChild = true
        theme.parentTheme = parentMatch[1]
      }
    }
  }

  return theme;
}

export async function POST(req: Request) {
  try {
    const { url } = await req.json()

    if (!url) {
      return NextResponse.json({ error: "URL-osoite vaaditaan" }, { status: 400 })
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      return NextResponse.json({ error: "Virheellinen URL-muoto" }, { status: 400 })
    }

    console.log(`Attempting to fetch: ${url}`)
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; WPScraper/1.0)',
      },
    })

    if (!response.ok) {
      return NextResponse.json({ 
        error: `Sivuston hakeminen epäonnistui: ${response.status} ${response.statusText}` 
      }, { status: response.status })
    }

    const html = await response.text()
    const $ = cheerio.load(html)

    // Basic site info
    const title = $('title').text().trim()
    const metaDescription = $('meta[name="description"]').attr('content')?.trim()

    // WordPress version detection - check multiple locations
    let wpVersion = "Unknown"
    
    // Method 1: Check meta generator
    const metaGenerator = $('meta[name="generator"]').attr("content") || ""
    let wpVersionMatch = metaGenerator.match(/WordPress\s+([\d.]+)/)
    
    // Method 2: Check RSS feed link
    if (!wpVersionMatch) {
      const rssLink = $('link[rel="alternate"][type="application/rss+xml"]').attr("href") || ""
      wpVersionMatch = rssLink.match(/\?v=([\d.]+)/)
    }
    
    // Method 3: Check readme.html
    if (!wpVersionMatch) {
      try {
        const readmeResponse = await fetch(`${new URL(url).origin}/readme.html`)
        if (readmeResponse.ok) {
          const readmeHtml = await readmeResponse.text()
          const readmeMatch = readmeHtml.match(/Version\s+([\d.]+)/)
          if (readmeMatch) wpVersionMatch = readmeMatch
        }
      } catch {
        console.log('Failed to check readme.html')
      }
    }

    if (wpVersionMatch) {
      wpVersion = wpVersionMatch[1]
    }

    // PHP version detection - multiple methods
    let phpVersion = "Unknown"
    
    // Method 1: Check meta generator
    let phpVersionMatch = metaGenerator.match(/PHP\s+([\d.]+)/)
    
    // Method 2: Check headers
    if (!phpVersionMatch) {
      const serverHeader = response.headers.get('server') || ''
      const xPoweredBy = response.headers.get('x-powered-by') || ''
      
      phpVersionMatch = serverHeader.match(/PHP\/([\d.]+)/) ||
                       xPoweredBy.match(/PHP\/([\d.]+)/)
    }
    
    // Method 3: Check common PHP files
    if (!phpVersionMatch) {
      try {
        const phpinfoResponse = await fetch(`${new URL(url).origin}/phpinfo.php`)
        if (phpinfoResponse.ok) {
          const phpinfoHtml = await phpinfoResponse.text()
          phpVersionMatch = phpinfoHtml.match(/PHP Version\s+([\d.]+)/)
        }
      } catch {
        console.log('Failed to check phpinfo.php')
      }
    }

    if (phpVersionMatch) {
      phpVersion = phpVersionMatch[1]
    }

    // Add after PHP version detection
    let apacheVersion = "Unknown"

    // Check server header for Apache version
    const serverHeader = response.headers.get('server') || ''
    const apacheMatch = serverHeader.match(/Apache\/([0-9.]+)/i) ||
                       serverHeader.match(/Apache\s+([0-9.]+)/i)

    if (apacheMatch) {
      apacheVersion = apacheMatch[1]
    }

    // Enhanced plugin detection
    const plugins: Plugin[] = []
    
    // Method 1: Check stylesheets and scripts with more patterns
    $('link[rel="stylesheet"], script').each((_, elem) => {
      const src = $(elem).attr("href") || $(elem).attr("src") || ""
      if (src.includes("/wp-content/plugins/")) {
        const match = src.match(/\/wp-content\/plugins\/([^/]+)/)
        if (match) {
          const name = match[1]
          // Skip if we already found this plugin
          if (!plugins.some(p => p.name.toLowerCase() === name.toLowerCase())) {
            const versionMatch = 
              src.match(/\?ver=([0-9.]+)/) ||
              src.match(/\.([0-9.]+)\.(?:min\.)?(?:js|css)/) ||
              src.match(/\-([0-9.]+)\.(?:min\.)?(?:js|css)/) ||
              src.match(/version[=\/-]([0-9.]+)/i)
            plugins.push(createPlugin(name, versionMatch?.[1] || null));
          }
        }
      }
    })
    
    // Method 2: Check HTML comments for plugin versions
    const htmlContent = $.html()
    const commentMatches = htmlContent.match(/<!--[^>]*?plugin[^>]*?-->/gi) || []
    commentMatches.forEach(comment => {
      const pluginMatch = 
        comment.match(/plugin\s+'([^']+)'\s+version\s+'([^']+)'/) ||
        comment.match(/Plugin Name:\s*([^\n]+)[\s\S]*?Version:\s*([^\n]+)/)
      if (pluginMatch) {
        const [, name, version] = pluginMatch
        if (!plugins.some(p => p.name === name)) {
          plugins.push(createPlugin(name, version))
        }
      }
    })

    // Method 3: Check meta tags and link tags
    $('meta[name^="generator-"], link[rel^="generator-"]').each((_, elem) => {
      const name = $(elem).attr('name')?.replace('generator-', '') ||
                   $(elem).attr('rel')?.replace('generator-', '')
      const version = $(elem).attr('content') || $(elem).attr('href')?.match(/\?ver=([0-9.]+)/)?.[1]
      if (name && version && !plugins.some(p => p.name === name)) {
        plugins.push(createPlugin(name, version))
      }
    })

    // Method 4: Look for wp-json API endpoints that might reveal plugins
    try {
      const apiResponse = await fetch(`${new URL(url).origin}/wp-json/`)
      if (apiResponse.ok) {
        const apiData = await apiResponse.json() as { namespaces?: string[] }
        const namespaces = apiData?.namespaces || []
        namespaces.forEach((namespace: string) => {
          if (namespace !== 'wp/v2' && !namespace.startsWith('core')) {
            const name = namespace.split('/')[0]
            if (!plugins.some(p => p.name === name)) {
              plugins.push(createPlugin(name, null))
            }
          }
        })
      }
    } catch {
      console.log('Failed to check wp-json API')
    }

    // Security check
    const hasSecurityPlugin = plugins.some((plugin: Plugin) =>
      [
        "wordfence",
        "sucuri-scanner", 
        "all-in-one-wp-security-and-firewall",
        "better-wp-security",
        "shield-security",
        "wp-security-audit-log"
      ].includes(plugin.name.toLowerCase())
    )

    // Version check
    const latestWPVersion = "6.4.3"
    const isWPUpToDate = wpVersion !== "Unknown" && semver.valid(wpVersion) 
      ? semver.gte(wpVersion, latestWPVersion)
      : false

    // Additional WordPress detection
    const isWordPress = 
      $('link[rel="https://api.w.org/"]').length > 0 ||
      $('meta[name="generator"][content*="WordPress"]').length > 0 ||
      html.includes('/wp-content/') ||
      html.includes('/wp-includes/') ||
      wpVersion !== "Unknown"

    // Add version checks for plugins
    await Promise.all(
      plugins.map(async (plugin) => {
        const pluginSlug = normalizePluginSlug(plugin.name)
        const latestVersion = await getLatestPluginVersion(pluginSlug)
        if (latestVersion) {
          plugin.latestVersion = latestVersion
          plugin.isUpToDate = semver.valid(plugin.version) && semver.valid(latestVersion) 
            ? semver.gte(plugin.version, latestVersion)
            : undefined
        }
      })
    )

    // Add directory scanning results
    try {
      const directoryPlugins = await scanPluginDirectory(new URL(url).origin)
      directoryPlugins.forEach(plugin => {
        if (!plugins.some(p => p.name === plugin.name)) {
          plugins.push(plugin)
        }
      })
    } catch {
      console.log('Failed to scan plugin directory')
    }

    // Add premium plugins detection
    const premiumPlugins = detectPremiumPlugins($, html);
    premiumPlugins.forEach(plugin => {
      if (!plugins.some(p => p.name === plugin.name)) {
        plugins.push(plugin);
      }
    });

    // Detect theme
    const theme = detectTheme($, html);

    return NextResponse.json({
      title,
      metaDescription,
      isWordPress,
      wpVersion,
      phpVersion,
      apacheVersion,
      plugins,
      hasSecurityPlugin,
      isWPUpToDate,
      theme,
    })

  } catch (error) {
    console.error("Scraping error:", error)
    return NextResponse.json(
      {
        error: "Sivuston tarkistus epäonnistui",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}

