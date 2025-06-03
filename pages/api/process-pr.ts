import { NextApiRequest, NextApiResponse } from 'next';
import { PRExtractor } from '../../lib/prExtractor';
import { GoogleSheetsService } from '../../lib/googleSheets';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { url } = req.body; // ✅ FIXED: Removed recaptchaToken

    // ✅ FIXED: Removed all ReCAPTCHA verification code

    // Validate URL
    if (!url || !isValidUrl(url)) {
      return res.status(400).json({ error: 'Invalid URL provided' });
    }

    // Process in background (don't wait for completion)
    processInBackground(url);

    return res.status(200).json({ 
      message: 'PR submitted for processing. Data will be added to the spreadsheet shortly.' 
    });

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function processInBackground(url: string) {
  try {
    const extractor = new PRExtractor();
    const sheetsService = new GoogleSheetsService();

    // Initialize sheet headers if needed
    await sheetsService.initializeSheet();

    // Extract data with detailed logging
    console.log('About to start extraction...');
    const prData = await extractor.extractPRData(url);
    console.log('Extraction completed with data:', prData);
    
    // Save to Google Sheets
    console.log('About to save to sheets...');
    await sheetsService.appendData(prData);
    console.log('Successfully saved to sheets');
    
    console.log('Successfully processed PR:', url);
  } catch (error) {
    console.error('Background processing error:', error);
    console.error('Error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : 'No stack trace'
    });
  }
}

function isValidUrl(string: string): boolean {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}