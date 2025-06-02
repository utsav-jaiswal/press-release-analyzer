import axios from 'axios';

export interface ApolloContact {
  email: string;
  firstName: string;
  lastName: string;
  title: string;
  confidence: number;
}

export interface ApolloResult {
  ceoEmail?: string;
  cmoEmail?: string;
  ceoName?: string;
  cmoName?: string;
  searchDetails: {
    companySearched: string;
    creditsUsed: number;
    totalResultsFound: number;
  };
}

export class ApolloService {
  private apiKey: string;
  private baseUrl = 'https://api.apollo.io/api/v1';

  constructor() {
    if (!process.env.APOLLO_API_KEY) {
      throw new Error('APOLLO_API_KEY environment variable is required');
    }
    this.apiKey = process.env.APOLLO_API_KEY;
  }

  async findExecutiveContacts(companyName: string): Promise<ApolloResult> {
    console.log(`Searching Apollo for executives at: ${companyName}`);
    
    const result: ApolloResult = {
      searchDetails: {
        companySearched: companyName,
        creditsUsed: 0,
        totalResultsFound: 0
      }
    };

    try {
      // Try to find CEO
      const ceoResult = await this.findExecutiveByTitle(companyName, 'CEO');
      if (ceoResult) {
        result.ceoEmail = ceoResult.email;
        result.ceoName = `${ceoResult.firstName} ${ceoResult.lastName}`.trim();
        result.searchDetails.creditsUsed += 1;
        result.searchDetails.totalResultsFound += 1;
        console.log(`Found CEO: ${result.ceoName} (${result.ceoEmail})`);
      }

      // Try to find CMO
      const cmoResult = await this.findExecutiveByTitle(companyName, 'CMO');
      if (cmoResult) {
        result.cmoEmail = cmoResult.email;
        result.cmoName = `${cmoResult.firstName} ${cmoResult.lastName}`.trim();
        result.searchDetails.creditsUsed += 1;
        result.searchDetails.totalResultsFound += 1;
        console.log(`Found CMO: ${result.cmoName} (${result.cmoEmail})`);
      }

      console.log(`Apollo search completed. Credits used: ${result.searchDetails.creditsUsed}`);
      return result;

    } catch (error) {
      console.error('Apollo search error:', error);
      return result;
    }
  }

  private async findExecutiveByTitle(companyName: string, title: 'CEO' | 'CMO'): Promise<ApolloContact | null> {
    try {
      // Step 1: Search for people with the specified title at the company
      const searchResults = await this.searchPeopleByTitle(companyName, title);
      
      if (searchResults.length === 0) {
        console.log(`No ${title} found for ${companyName}`);
        return null;
      }

      // Step 2: Enrich the first result to get email
      const topCandidate = searchResults[0];
      const enrichedContact = await this.enrichPerson(topCandidate.firstName, topCandidate.lastName, companyName);
      
      return enrichedContact;
    } catch (error) {
      console.error(`Error finding ${title} for ${companyName}:`, error);
      return null;
    }
  }

  private async searchPeopleByTitle(companyName: string, title: 'CEO' | 'CMO'): Promise<ApolloContact[]> {
    try {
      const titleQueries = title === 'CEO' 
        ? ['CEO', 'Chief Executive Officer', 'Founder', 'Co-Founder']
        : ['CMO', 'Chief Marketing Officer', 'VP Marketing', 'Vice President Marketing', 'Head of Marketing'];

      console.log(`Searching for ${titleQueries.join(' OR ')} at ${companyName}`);

      const response = await axios.post(`${this.baseUrl}/mixed_people/search`, {
  q_organization_name: companyName,
  person_titles: titleQueries,
  page: 1,
  per_page: 5
}, {
        headers: {
  'Content-Type': 'application/json',
  'X-Api-Key': this.apiKey,
  'Cache-Control': 'no-cache'
},
        timeout: 15000
      });

      if (response.data && response.data.people && response.data.people.length > 0) {
        const contacts: ApolloContact[] = response.data.people.map((person: any) => ({
          email: '', // People search doesn't return emails
          firstName: person.first_name || '',
          lastName: person.last_name || '',
          title: person.title || '',
          confidence: this.calculateTitleMatch(person.title || '', titleQueries)
        })).sort((a, b) => b.confidence - a.confidence);

        console.log(`Found ${contacts.length} ${title} candidates`);
        return contacts;
      }

      return [];
    } catch (error) {
      console.error(`People search error for ${title}:`, error);
      return [];
    }
  }

  private async enrichPerson(firstName: string, lastName: string, companyName: string): Promise<ApolloContact | null> {
    try {
      console.log(`Enriching contact: ${firstName} ${lastName} at ${companyName}`);

      // Use People Enrichment endpoint to get email
      const response = await axios.post(`${this.baseUrl}/people/match`, {
  first_name: firstName,
  last_name: lastName,
  organization_name: companyName,
  reveal_personal_emails: false,
  reveal_phone_number: false
}, {
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': this.apiKey,
          'Cache-Control': 'no-cache'
        },
        timeout: 15000
      });

      if (response.data && response.data.person && response.data.person.email) {
        const person = response.data.person;
        console.log(`Successfully enriched: ${person.email}`);
        
        return {
          email: person.email,
          firstName: person.first_name || firstName,
          lastName: person.last_name || lastName,
          title: person.title || '',
          confidence: 90 // High confidence since this was enriched
        };
      }

      console.log(`No email found during enrichment for ${firstName} ${lastName}`);
      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          console.error('Invalid Apollo API key');
        } else if (error.response?.status === 402) {
          console.error('Apollo API quota exceeded');
        } else if (error.response?.status === 429) {
          console.error('Apollo API rate limit exceeded');
        } else {
          console.error('Apollo enrichment error:', error.response?.data || error.message);
        }
      } else {
        console.error('Enrichment error:', error);
      }
      return null;
    }
  }

  private calculateTitleMatch(personTitle: string, targetTitles: string[]): number {
    const lowerTitle = personTitle.toLowerCase();
    
    for (const target of targetTitles) {
      if (lowerTitle.includes(target.toLowerCase())) {
        // Exact match gets highest score
        if (lowerTitle === target.toLowerCase()) return 100;
        // Partial match gets good score
        return 80;
      }
    }
    
    return 50; // Base score
  }

  async testConnection(): Promise<boolean> {
    try {
      // Simple test to verify API key works
      const response = await axios.post(`${this.baseUrl}/people/match`, {
  first_name: 'Test',
  last_name: 'User',
  organization_name: 'Test Company'
}, {
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': this.apiKey
        },
        timeout: 10000
      });

      return response.status === 200;
    } catch (error) {
      console.error('Apollo connection test failed:', error);
      return false;
    }
  }
}