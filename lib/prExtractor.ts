import axios from 'axios';
import * as cheerio from 'cheerio';
import Anthropic from '@anthropic-ai/sdk';
import { PRData } from './types';
import { ApolloService } from './apolloService';

export class PRExtractor {
  private anthropic: Anthropic;
  private maxRetries = 2;

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });
  }

  async extractPRData(url: string): Promise<PRData> {
    let attempt = 0;
    let lastError = '';

    while (attempt <= this.maxRetries) {
      try {
        return await this.performExtraction(url);
      } catch (error) {
        attempt++;
        lastError = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Extraction attempt ${attempt} failed:`, error);
        
        if (attempt <= this.maxRetries) {
          console.log(`Retrying in 3 seconds...`);
          await this.delay(3000);
        }
      }
    }

    return {
      companyName: 'EXTRACTION FAILED',
      ceoEmail: 'EMAIL NOT FOUND',
      cmoEmail: 'EMAIL NOT FOUND',
      leadInvestor: 'EXTRACTION FAILED',
      followOnInvestors: [],
      amountRaised: 'EXTRACTION FAILED',
      classification: 'UNKNOWN',
      isScam: false,
      confidence: 0,
      extractionErrors: [lastError]
    };
  }

private async performExtraction(url: string): Promise<PRData> {
  console.log('Starting Claude-powered extraction for:', url);
  
  // Step 1: Try direct fetch first
  let prContent = '';
  let extractionMethod = '';
  
  try {
    prContent = await this.fetchPRContent(url);
    extractionMethod = 'direct_fetch';
  } catch (error) {
    console.log('Direct fetch failed, trying fallback methods...');
    
    // Step 2: Try URL-based extraction for known patterns
    prContent = await this.tryUrlBasedExtraction(url);
    extractionMethod = 'url_based';
  }
  
  if (!prContent) {
    throw new Error('Unable to access content from this URL with any method');
  }
  
  console.log(`Content extracted via: ${extractionMethod}`);
  
  // Step 3: Use Claude to extract structured data
  const extractedData = await this.extractWithClaude(prContent, url);
  
  // Step 4: Find executive contacts (if company name was found)
  let executiveContacts: { ceoEmail?: string; cmoEmail?: string } = {};
  if (extractedData.companyName && extractedData.companyName !== 'NOT FOUND') {
    executiveContacts = await this.findExecutiveContactsWithApollo(extractedData.companyName);
  }
  
  const result = {
    companyName: extractedData.companyName,
    ceoEmail: executiveContacts.ceoEmail || 'EMAIL NOT FOUND',
    cmoEmail: executiveContacts.cmoEmail || 'EMAIL NOT FOUND',
    leadInvestor: extractedData.leadInvestor,
    followOnInvestors: extractedData.followOnInvestors,
    amountRaised: extractedData.amountRaised,
    classification: extractedData.classification,
    isScam: extractedData.isScam,
    confidence: extractedData.confidence,
    extractionErrors: []
  };

  console.log('Claude extraction completed:', result);
  return result;
}

  private async fetchPRContent(url: string): Promise<string> {
  try {
    // Enhanced headers to bypass basic bot detection
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0'
    };

    console.log('Attempting to fetch URL with enhanced headers...');
    
    const response = await axios.get(url, {
      timeout: 30000,
      headers,
      maxRedirects: 5,
      validateStatus: (status) => status < 500, // Accept redirects and client errors
    });
    
    console.log(`Response status: ${response.status}`);
    
    if (response.status === 403 || response.status === 401) {
      throw new Error('Access denied - site requires authentication or blocks bots');
    }
    
    if (response.status === 404) {
      throw new Error('Article not found (404)');
    }
    
    if (response.status >= 400) {
      throw new Error(`HTTP ${response.status}: Unable to access article`);
    }

    const html = response.data;
    
    if (!html || html.length < 100) {
      throw new Error('Empty or invalid response received');
    }

    console.log(`Successfully fetched ${html.length} characters of content`);

    // Extract clean text content with enhanced selectors for news sites
    const $ = cheerio.load(html);
    
    // Remove unwanted elements
    $('script, style, nav, footer, aside, .advertisement, .ad, .social-share, .cookie-banner, .subscription-wall').remove();
    
    // Try multiple selectors for different news site layouts
    const contentSelectors = [
      // Reuters specific
      'article [data-module="ArticleBody"]',
      '.ArticleBody-container',
      '.StandardArticleBody_container',
      
      // Generic news selectors
      'article .article-body',
      'article .content',
      'article .post-content',
      '.article-content',
      '.story-body',
      '.entry-content',
      'main article',
      'article',
      
      // Fallback
      'main',
      '.main-content'
    ];
    
    let mainContent = '';
    for (const selector of contentSelectors) {
      const content = $(selector).first().text().trim();
      if (content && content.length > 200) {
        mainContent = content;
        console.log(`Found content using selector: ${selector}`);
        break;
      }
    }
    
    // If no good content found, try the whole body but filter better
    if (!mainContent || mainContent.length < 200) {
      console.log('Falling back to body content...');
      mainContent = $('body').text().trim();
    }
    
    if (!mainContent || mainContent.length < 100) {
      throw new Error('No meaningful content found on the page');
    }
    
    // Get additional metadata
    const title = $('title').text().trim() || $('h1').first().text().trim();
    const description = $('meta[name="description"]').attr('content') || '';
    
    // Combine and clean
    let content = `Title: ${title}\n\nDescription: ${description}\n\nContent: ${mainContent}`;
    
    // Clean up whitespace but preserve structure
    content = content.replace(/\s+/g, ' ').trim();
    
    console.log(`Extracted ${content.length} characters of clean content`);
    
    return content;
    
  } catch (error) {
    console.error('Fetch error details:', error);
    
    if (axios.isAxiosError(error)) {
      if (error.code === 'ENOTFOUND') {
        throw new Error('Website not found - check if URL is correct');
      }
      if (error.code === 'ECONNREFUSED') {
        throw new Error('Connection refused - website may be down');
      }
      if (error.code === 'ETIMEDOUT') {
        throw new Error('Request timed out - website is too slow to respond');
      }
      if (error.response?.status === 403) {
        throw new Error('Access forbidden - website blocks automated access');
      }
      if (error.response?.status === 404) {
        throw new Error('Article not found (404)');
      }
      if (error.response?.status === 429) {
        throw new Error('Rate limited - too many requests');
      }
    }
    
    throw new Error(`Unable to access this link: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
private async tryUrlBasedExtraction(url: string): Promise<string> {
  console.log('Attempting URL-based extraction...');
  
  // For Business Wire URLs, we can often extract key info from the URL itself
  if (url.includes('businesswire.com')) {
    return this.extractFromBusinessWireUrl(url);
  }
  
  // For PR Newswire URLs
  if (url.includes('prnewswire.com')) {
    return this.extractFromPRNewswireUrl(url);
  }
  
  // Generic URL-based extraction
  return this.extractFromGenericUrl(url);
}

private extractFromBusinessWireUrl(url: string): string {
  // Business Wire URL format: /news/home/DATE/en/Company-Action-Amount-Details
  const urlParts = url.split('/');
  const titlePart = urlParts[urlParts.length - 1] || '';
  
  // Example: "FTV-Capital-Completes-Record-%244.05-Billion-Growth-Equity-Fundraise"
  let cleanTitle = decodeURIComponent(titlePart)
    .replace(/-/g, ' ')
    .replace(/\%24/g, '$'); // Decode $
  
  console.log('Extracted from Business Wire URL:', cleanTitle);
  
  // Create a synthetic press release content
  const content = `
Title: ${cleanTitle}

This is a Business Wire press release about: ${cleanTitle}

Based on the URL structure, this appears to be an announcement about:
${cleanTitle}

The URL suggests this is a significant business announcement that was published via Business Wire's platform.
`;
  
  return content;
}

private extractFromPRNewswireUrl(url: string): string {
  const urlParts = url.split('/');
  const titlePart = urlParts.find(part => part.includes('raises') || part.includes('announces') || part.includes('funding')) || '';
  
  let cleanTitle = titlePart.replace(/-/g, ' ');
  
  const content = `
Title: ${cleanTitle}

This is a PR Newswire press release about: ${cleanTitle}

Based on the URL, this appears to be a funding or business announcement.
`;
  
  return content;
}

private extractFromGenericUrl(url: string): string {
  // Try to extract info from any URL structure
  const urlObj = new URL(url);
  const pathname = urlObj.pathname;
  const titlePart = pathname.split('/').pop() || '';
  
  let cleanTitle = titlePart.replace(/[-_]/g, ' ');
  
  const content = `
Title: ${cleanTitle}

URL: ${url}

This appears to be a business or funding announcement based on the URL structure.
The specific content could not be accessed due to access restrictions.
`;
  
  return content;
}

  private async extractWithClaude(content: string, url: string): Promise<{
    companyName: string;
    leadInvestor: string;
    followOnInvestors: string[];
    amountRaised: string;
    classification: string;
    isScam: boolean;
    confidence: number;
  }> {
    const prompt = `You are an expert at extracting structured data from press releases about company funding announcements. 

Please analyze the following press release content and URL, then extract the requested information.

URL: ${url}

CONTENT:
${content.substring(0, 8000)} ${content.length > 8000 ? '...(truncated)' : ''}

Please extract the following information and respond ONLY with a valid JSON object in this exact format:

{
  "companyName": "The name of the company that raised funding (not the investor or parent company)",
  "leadInvestor": "The lead investor or main investor mentioned (if any)",
  "followOnInvestors": ["Array of follow-on or participating investors"],
  "amountRaised": "Funding amount in format like '$150M' or '$4.05B' (use M for millions, B for billions)",
  "classification": "One of: Web3 Company, AI Company, AI SaaS Company, SaaS Company, Software Company, Fintech Company, Biotech Company, CleanTech Company, Investment Firm, Other",
  "isScam": false,
  "confidence": 85
}

IMPORTANT GUIDELINES:
1. For company name: Look for the actual company that received funding. Extract from URL if unclear in content (e.g., "tae-technologies-raises" → "TAE Technologies")
2. For funding amount: Look for patterns like "$150 million", "$4.05 billion", "150M", etc. Convert to standard format.
3. For investors: Distinguish between lead investors (who led the round) and follow-on/participating investors
4. For classification: Choose the most specific category that fits
5. If information is clearly not found, use: "NOT FOUND" for strings, [] for arrays
6. Confidence should be 0-100 based on how clear and complete the information is
7. Set isScam to true only for obviously fraudulent/suspicious announcements

Respond with ONLY the JSON object, no additional text.`;

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });

      const responseText = response.content[0].type === 'text' ? response.content[0].text : '';
      console.log('Claude response:', responseText);
      
      // Parse the JSON response
      const extracted = JSON.parse(responseText);
      
      return {
        companyName: extracted.companyName || 'NOT FOUND',
        leadInvestor: extracted.leadInvestor || 'NOT FOUND',
        followOnInvestors: Array.isArray(extracted.followOnInvestors) ? extracted.followOnInvestors : [],
        amountRaised: extracted.amountRaised || 'NOT FOUND',
        classification: extracted.classification || 'Other',
        isScam: Boolean(extracted.isScam),
        confidence: Number(extracted.confidence) || 0
      };
    } catch (error) {
      console.error('Claude extraction error:', error);
      throw new Error(`Claude extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

private async findExecutiveContactsWithApollo(companyName: string): Promise<{
  ceoEmail?: string;
  cmoEmail?: string;
}> {
  if (companyName === 'NOT FOUND' || companyName === 'EXTRACTION FAILED') {
    return {};
  }

  console.log('Finding executive contacts via Apollo for:', companyName);
  
  try {
    const apolloService = new ApolloService();
    const result = await apolloService.findExecutiveContacts(companyName);
    
    console.log(`Apollo found: CEO=${result.ceoEmail || 'not found'}, CMO=${result.cmoEmail || 'not found'}`);
    console.log(`Credits used: ${result.searchDetails.creditsUsed}`);
    
    return {
      ceoEmail: result.ceoEmail,
      cmoEmail: result.cmoEmail
    };
  } catch (error) {
    console.error('Apollo service error:', error);
    
    // Fallback to web scraping if Apollo fails
    console.log('Falling back to web scraping...');
    return {
  ceoEmail: undefined,
  cmoEmail: undefined
};
  }
}

  private async searchCompanyWebsite(companyName: string): Promise<string | null> {
    const domains = this.generatePossibleDomains(companyName);
    
    for (const domain of domains.slice(0, 3)) { // Try top 3 domains
      const urls = [
        `https://${domain}`,
        `https://www.${domain}`,
        `https://${domain}/about`,
        `https://${domain}/team`,
        `https://${domain}/leadership`,
        `https://${domain}/about-us`,
        `https://${domain}/management`
      ];

      for (const url of urls) {
        try {
          console.log(`Trying to fetch: ${url}`);
          const response = await axios.get(url, { 
            timeout: 10000,
            headers: { 
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
          });
          
          if (response.status === 200) {
            const $ = cheerio.load(response.data);
            
            // Remove unnecessary elements
            $('script, style, nav, footer, .advertisement').remove();
            
            const content = $('body').text();
            
            // Look for executive-related content
            if (content.toLowerCase().includes('ceo') || 
                content.toLowerCase().includes('chief executive') ||
                content.toLowerCase().includes('founder') ||
                content.toLowerCase().includes('team') ||
                content.toLowerCase().includes('leadership')) {
              
              console.log(`Found relevant content on: ${url}`);
              return content.substring(0, 5000); // Limit content size
            }
          }
        } catch (error) {
          continue; // Try next URL
        }
      }
    }
    
    return null;
  }

  private async extractExecutivesWithClaude(websiteContent: string, companyName: string): Promise<{
    ceoEmail?: string;
    cmoEmail?: string;
  }> {
    const prompt = `You are an expert at extracting executive contact information from company website content.

Company Name: ${companyName}

Website Content:
${websiteContent}

Please analyze this content and extract executive information. Look for:
1. CEO, Chief Executive Officer, Founder, Co-Founder names
2. CMO, Chief Marketing Officer, Head of Marketing, Marketing Director names
3. Email addresses associated with these executives

Respond ONLY with a valid JSON object in this exact format:

{
  "ceoName": "Name of CEO/Founder if found, or null",
  "ceoEmail": "Email of CEO if found, or constructed email if name found, or null",
  "cmoName": "Name of CMO/Marketing head if found, or null", 
  "cmoEmail": "Email of CMO if found, or constructed email if name found, or null"
}

IMPORTANT GUIDELINES:
1. If you find a name but no direct email, construct a likely email using common patterns:
   - firstname.lastname@companydomain.com
   - firstname@companydomain.com
   - f.lastname@companydomain.com
2. Use the company domain from any email found on the site
3. If no names or emails found, use null for all fields
4. Be conservative - only include information you're confident about

Respond with ONLY the JSON object, no additional text.`;

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });

      const responseText = response.content[0].type === 'text' ? response.content[0].text : '';
      console.log('Claude executive extraction response:', responseText);
      
      const extracted = JSON.parse(responseText);
      
      return {
        ceoEmail: extracted.ceoEmail || undefined,
        cmoEmail: extracted.cmoEmail || undefined
      };
    } catch (error) {
      console.error('Claude executive extraction error:', error);
      return {};
    }
  }

  private generatePossibleDomains(companyName: string): string[] {
    const cleanName = companyName
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '');

    const domains = [
      `${cleanName}.com`,
      `${cleanName}.co`,
      `${cleanName}.io`
    ];

    // Remove common words and try again
    const withoutCommon = cleanName
      .replace(/(technologies|tech|systems|solutions|labs|inc|corp|ltd|company|co)/g, '');
    
    if (withoutCommon !== cleanName && withoutCommon.length > 2) {
      domains.push(
        `${withoutCommon}.com`,
        `${withoutCommon}.co`,
        `${withoutCommon}.io`
      );
    }

    return domains;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}