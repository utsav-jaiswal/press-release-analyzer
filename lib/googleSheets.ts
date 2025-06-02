import { google } from 'googleapis';
import { PRData } from './types';

export class GoogleSheetsService {
  private sheets: any;

  constructor() {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        type: 'service_account',
        private_key: process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        client_email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    this.sheets = google.sheets({ version: 'v4', auth });
  }

  async appendData(data: PRData): Promise<void> {
    const values = [[
      data.companyName,
      data.ceoEmail,
      data.cmoEmail,
      data.leadInvestor,
      data.followOnInvestors.join(', '),
      data.amountRaised,
      data.classification,
      data.isScam ? 'FLAGGED AS SUSPICIOUS' : '',
      new Date().toISOString()
    ]];

    await this.sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Sheet1!A:I',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values }
    });

    // Add conditional formatting for scam flagging
    if (data.isScam) {
      await this.flagSuspiciousRow();
    }
  }

  private async flagSuspiciousRow(): Promise<void> {
    // Get the last row number
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Sheet1!A:A'
    });
    
    const rowCount = response.data.values?.length || 1;
    
    // Apply yellow background to the last row
    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      requestBody: {
        requests: [{
          repeatCell: {
            range: {
              startRowIndex: rowCount - 1,
              endRowIndex: rowCount,
              startColumnIndex: 0,
              endColumnIndex: 9
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: {
                  red: 1.0,
                  green: 1.0,
                  blue: 0.8
                }
              }
            },
            fields: 'userEnteredFormat.backgroundColor'
          }
        }]
      }
    });
  }

  async initializeSheet(): Promise<void> {
    const headers = [
      'Company Name',
      'CEO Email', 
      'CMO Email',
      'Lead Investor',
      'Follow-on Investors',
      'Amount Raised',
      'Classification',
      'Flags',
      'Date Processed'
    ];

    try {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: 'Sheet1!A1:I1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [headers] }
      });
    } catch (error) {
      console.log('Headers may already exist');
    }
  }
}