import { NextResponse } from "next/server"
import fetch from "node-fetch"
import * as cheerio from "cheerio"
import semver from "semver"

interface Plugin {
  name: string;
  version: string;
}

export async function POST(req: Request) {
  try {
    const { url } = await req.json()

    if (!url) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 })
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      return NextResponse.json({ error: "Invalid URL format" }, { status: 400 })
    }

    console.log(`Attempting to fetch: ${url}`)
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; WPScraper/1.0)',
      },
    })

    if (!response.ok) {
      return NextResponse.json({ 
        error: `Failed to fetch URL: ${response.status} ${response.statusText}` 
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

    // Enhanced plugin detection
    const plugins: Plugin[] = []
    
    // Method 1: Check stylesheets and scripts
    $('link[rel="stylesheet"], script').each((_, elem) => {
      const src = $(elem).attr("href") || $(elem).attr("src") || ""
      if (src.includes("/wp-content/plugins/")) {
        const match = src.match(/\/wp-content\/plugins\/([^/]+)/)
        if (match) {
          const name = match[1]
          const version = src.match(/\?ver=([\d.]+)/)?.[1] || "Unknown"
          if (!plugins.some(p => p.name === name)) {
            plugins.push({ name, version })
          }
        }
      }
    })
    
    // Method 2: Check HTML comments for plugin versions
    const htmlContent = $.html()
    const commentMatches = htmlContent.match(/<!--[^>]*?plugin[^>]*?-->/gi) || []
    commentMatches.forEach(comment => {
      const pluginMatch = comment.match(/plugin\s+'([^']+)'\s+version\s+'([^']+)'/)
      if (pluginMatch) {
        const [, name, version] = pluginMatch
        if (!plugins.some(p => p.name === name)) {
          plugins.push({ name, version })
        }
      }
    })

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

    return NextResponse.json({
      title,
      metaDescription,
      isWordPress,
      wpVersion,
      phpVersion,
      plugins,
      hasSecurityPlugin,
      isWPUpToDate,
    })

  } catch (error) {
    console.error("Scraping error:", error)
    return NextResponse.json(
      {
        error: "Failed to scrape website",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}

