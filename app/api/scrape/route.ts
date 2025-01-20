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

// Version detection patterns
// const VERSION_PATTERNS = [
//   /\?ver=([0-9.]+)/,
//   /\.([0-9.]+)\.(?:min\.)?(?:js|css)/,
//   /\-([0-9.]+)\.(?:min\.)?(?:js|css)/,
//   /version[=\/-]([0-9.]+)/i,
//   /var\s+\w+_version\s*=\s*['"]([0-9.]+)['"]/,
//   /\.version\s*=\s*['"]([0-9.]+)['"]/,
//   /data-version=['"]([0-9.]+)['"]/,
//   /VERSION\s*[:=]\s*['"]([0-9.]+)['"]/i,
//   /"version"\s*:\s*"([0-9.]+)"/,
//   /@since\s+([0-9.]+)/,
//   /<!--\s*v([0-9.]+)\s*-->/
// ];

// Premium plugin definitions
const PREMIUM_PLUGINS = [
  {
    name: 'RevSlider',
    pattern: /revslider.*?ver=([0-9.]+)/
  },
  {
    name: 'WPBakery Page Builder',
    pattern: /js_composer.*?ver=([0-9.]+)/
  },
  {
    name: 'Advanced Custom Fields Pro',
    pattern: /advanced-custom-fields-pro.*?ver=([0-9.]+)/
  },
  {
    name: 'Elementor Pro', 
    pattern: /elementor-pro.*?ver=([0-9.]+)/
  }
];

// Helper functions
function createPlugin(name: string, version: string | null): Plugin {
  return {
    name,
    version: version || "Unknown",
    versionDetected: version !== null && version !== "Unknown"
  };
}

function normalizePluginSlug(name: string): string {
  return name.toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
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

// Add these new detection methods
async function checkWPJson(baseUrl: string): Promise<Plugin[]> {
  const plugins: Plugin[] = [];
  try {
    const response = await fetch(`${baseUrl}/wp-json/`);
    if (response.ok) {
      const data = await response.json() as { namespaces?: string[] };
      data.namespaces?.forEach(namespace => {
        // Skip core WordPress namespaces
        if (namespace !== 'wp/v2' && !namespace.startsWith('core')) {
          const name = namespace.split('/')[0];
          plugins.push(createPlugin(name, null));
        }
      });
    }
  } catch {
    // Silently fail
  }
  return plugins;
}

async function checkPluginReadme(baseUrl: string, pluginName: string): Promise<{name: string | null, version: string | null}> {
  try {
    const response = await fetch(`${baseUrl}/wp-content/plugins/${pluginName}/readme.txt`);
    if (response.ok) {
      const text = await response.text();
      const nameMatch = text.match(/=== (.+) ===/) || text.match(/Plugin Name:\s*(.+)$/m);
      const versionMatch = text.match(/Stable tag:\s*([0-9.]+)/) || 
                          text.match(/Version:\s*([0-9.]+)/);
      
      return {
        name: nameMatch ? nameMatch[1].trim() : null,
        version: versionMatch ? versionMatch[1] : null
      };
    }
  } catch {
    // Silently fail
  }
  return { name: null, version: null };
}

// Main plugin detection function
async function detectPlugins(baseUrl: string, $: cheerio.CheerioAPI, html: string): Promise<Plugin[]> {
  const plugins = new Map<string, Plugin>();
  
  // Helper to add plugin if not exists
  const addPlugin = (name: string, version: string | null) => {
    if (!plugins.has(name)) {
      plugins.set(name, createPlugin(name, version));
    }
  };

  // 1. Detect from script and style tags
  $('link[rel="stylesheet"], script').each((_, elem) => {
    const src = $(elem).attr("href") || $(elem).attr("src") || "";
    if (src.includes("/wp-content/plugins/")) {
      const match = src.match(/\/plugins\/([^/]+)/);
      if (match) {
        const name = match[1];
        const versionMatch = src.match(/\?ver=([0-9.]+)/);
        addPlugin(name, versionMatch?.[1] || null);
      }
    }
  });

  // 2. Detect premium plugins
  PREMIUM_PLUGINS.forEach(({name, pattern}) => {
    const match = html.match(pattern);
    if (match) {
      addPlugin(name, match[1]);
    }
  });

  // 3. Check plugin files
  await Promise.all(
    Array.from(plugins.keys()).map(async (name) => {
      try {
        const response = await fetch(`${baseUrl}/wp-content/plugins/${name}/${name}.php`);
        if (response.ok) {
          const text = await response.text();
          const versionMatch = text.match(/Version:\s*([0-9.]+)/);
          if (versionMatch) {
            const plugin = plugins.get(name);
            if (plugin) {
              plugin.version = versionMatch[1];
              plugin.versionDetected = true;
            }
          }
        }
      } catch {
        // Silently fail for individual plugin checks
      }
    })
  );

  // 4. Get latest versions from WordPress.org
  await Promise.all(
    Array.from(plugins.values()).map(async (plugin) => {
      const slug = normalizePluginSlug(plugin.name);
      const latestVersion = await getLatestPluginVersion(slug);
      if (latestVersion) {
        plugin.latestVersion = latestVersion;
        plugin.isUpToDate = semver.valid(plugin.version) && semver.valid(latestVersion) 
          ? semver.gte(plugin.version, latestVersion)
          : undefined;
      }
    })
  );

  // Add WP-JSON API check
  const jsonPlugins = await checkWPJson(baseUrl);
  jsonPlugins.forEach(plugin => {
    if (!plugins.has(plugin.name)) {
      plugins.set(plugin.name, plugin);
    }
  });

  // Check readme files for more accurate names and versions
  await Promise.all(
    Array.from(plugins.values()).map(async (plugin) => {
      const readmeInfo = await checkPluginReadme(baseUrl, plugin.name);
      if (readmeInfo.name) {
        plugin.name = readmeInfo.name;
      }
      if (readmeInfo.version && !plugin.versionDetected) {
        plugin.version = readmeInfo.version;
        plugin.versionDetected = true;
      }
    })
  );

  return Array.from(plugins.values());
}

// Theme detection
function detectTheme($: cheerio.CheerioAPI): Theme | null {
  const styleLink = $('link[rel="stylesheet"][href*="/wp-content/themes/"]').first();
  if (!styleLink.length) return null;

  const href = styleLink.attr('href') || '';
  const themeMatch = href.match(/\/themes\/([^/]+)/);
  if (!themeMatch) return null;

  const name = themeMatch[1];
  const versionMatch = href.match(/\?ver=([0-9.]+)/);
  
  const parentLink = $('link[rel="stylesheet"][href*="/wp-content/themes/"]')
    .filter((_, elem) => {
      const h = $(elem).attr('href') || '';
      return h.includes('/themes/') && !h.includes(`/themes/${name}/`);
    })
    .first();

  return {
    name,
    version: versionMatch?.[1] || null,
    isChild: parentLink.length > 0,
    parentTheme: parentLink.length ? parentLink.attr('href')?.match(/\/themes\/([^/]+)/)?.[1] : undefined
  };
}

export async function POST(req: Request) {
  try {
    const { url } = await req.json();

    if (!url) {
      return NextResponse.json({ error: "URL-osoite vaaditaan" }, { status: 400 });
    }

    try {
      new URL(url);
    } catch {
      return NextResponse.json({ error: "Virheellinen URL-muoto" }, { status: 400 });
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; WPScraper/1.0)',
      },
    });

    if (!response.ok) {
      return NextResponse.json({ 
        error: `Sivuston hakeminen epäonnistui: ${response.status} ${response.statusText}` 
      }, { status: response.status });
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Basic site info
    const title = $('title').text().trim();
    const metaDescription = $('meta[name="description"]').attr('content')?.trim();

    // WordPress detection
    const isWordPress = $('meta[name="generator"][content*="WordPress"]').length > 0 || 
                       html.includes('/wp-content/') ||
                       html.includes('/wp-includes/');

    // Version detections
    const wpMatch = html.match(/WordPress\s+([\d.]+)/);
    const wpVersion = wpMatch ? wpMatch[1] : "Unknown";

    const phpMatch = response.headers.get('x-powered-by')?.match(/PHP\/([\d.]+)/);
    const phpVersion = phpMatch ? phpMatch[1] : "Unknown";

    const apacheMatch = response.headers.get('server')?.match(/Apache\/([\d.]+)/i);
    const apacheVersion = apacheMatch ? apacheMatch[1] : "Unknown";

    // Plugin and theme detection
    const plugins = await detectPlugins(new URL(url).origin, $, html);
    const theme = detectTheme($);

    // Security check
    const hasSecurityPlugin = plugins.some(p => 
      ["wordfence", "sucuri-scanner", "better-wp-security", "shield-security"]
        .includes(p.name.toLowerCase())
    );

    // Version check
    const latestWPVersion = "6.4.3";
    const isWPUpToDate = wpVersion !== "Unknown" && semver.valid(wpVersion) 
      ? semver.gte(wpVersion, latestWPVersion)
      : false;

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
    });

  } catch (error) {
    console.error("Scraping error:", error);
    return NextResponse.json(
      {
        error: "Sivuston tarkistus epäonnistui",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
