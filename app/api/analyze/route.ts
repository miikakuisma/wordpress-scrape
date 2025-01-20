/* eslint-disable @typescript-eslint/no-explicit-any */
import { OpenAI } from 'openai'
import { NextResponse } from 'next/server'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 60000,
})

async function retryWithBackoff(fn: () => Promise<any>, maxRetries = 3): Promise<any> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      // Wait 2^i * 1000 ms between retries (1s, 2s, 4s)
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
    }
  }
}

export async function POST(req: Request) {
  try {
    const data = await req.json()
    
    const prompt = `Analyze this WordPress site security information and provide recommendations in Finnish:
    
WordPress Version: ${data.wpVersion}
PHP Version: ${data.phpVersion}
Apache Version: ${data.apacheVersion}
Security Plugin: ${data.hasSecurityPlugin ? 'Yes' : 'No'}
WordPress Up to Date: ${data.isWPUpToDate ? 'Yes' : 'No'}

Theme: ${data.theme ? `${data.theme.name} ${data.theme.version ? `v${data.theme.version}` : '(version unknown)'}` : 'Unknown'}
${data.theme?.isChild ? `Child Theme of: ${data.theme.parentTheme}` : ''}

Plugins:
${data.plugins.map((plugin: {name: string, currentVersion?: string, latestVersion?: string}) => 
  `- ${plugin.name} ${plugin.currentVersion ? `v${plugin.currentVersion}` : ''}${plugin.latestVersion ? ` (Latest: ${plugin.latestVersion})` : ''}`
).join('\n')}

Consider theme reputation and potential security implications. Child themes generally inherit parent theme vulnerabilities.

Please provide:
1. Security risk assessment
2. Specific recommendations for improvements
3. Priority list of actions needed
`

    const completion = await retryWithBackoff(() => 
      openai.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: "gpt-4o-mini",
      })
    );

    return NextResponse.json({
      analysis: completion.choices[0].message.content
    })

  } catch (error) {
    console.error('Analysis error:', error)
    return NextResponse.json(
      { error: 'Analyysi epäonnistui', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
} 