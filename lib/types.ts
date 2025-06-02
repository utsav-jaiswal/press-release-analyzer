export interface PRData {
  companyName: string;
  ceoEmail: string;
  cmoEmail: string;
  leadInvestor: string;
  followOnInvestors: string[];
  amountRaised: string;
  classification: string;
  isScam: boolean;
  confidence: number;
  extractionErrors: string[];
}

export interface ExecutiveContact {
  name: string;
  email: string;
  title: string;
  confidence: number;
}