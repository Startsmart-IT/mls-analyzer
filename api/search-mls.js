import axios from 'axios';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    const { address, propertyType, radiusMiles, daysBack } = req.body;

    if (!address) {
      return res.status(400).json({ 
        error: 'Address is required',
        example: '1234 Oak Lane, Cincinnati, OH 45206'
      });
    }

    const apiKey = process.env.RAPIDAPI_KEY;
    if (!apiKey) {
      console.error('RAPIDAPI_KEY not configured');
      return res.status(500).json({ 
        error: 'API key not configured',
        hint: 'Set RAPIDAPI_KEY in Vercel environment variables'
      });
    }

    console.log(`[SEARCH] Address: ${address}, API Key: ${apiKey.substring(0, 8)}...`);

    // Call RapidAPI Zillow (using classic API which is more reliable)
    const zillow_api_response = await axios.get(
      'https://zillow56.p.rapidapi.com/search',
      {
        params: {
          location: address,
          outputType: 'json'
        },
        headers: {
          'x-rapidapi-key': apiKey,
          'x-rapidapi-host': 'zillow56.p.rapidapi.com'
        },
        timeout: 10000
      }
    );

    const properties = zillow_api_response.data || [];

    if (!properties || properties.length === 0) {
      return res.status(404).json({ 
        error: `No properties found for: ${address}`,
        hint: 'Try a different address or city'
      });
    }

    // Get subject property (first result)
    const subject = properties[0];
    const comps = properties.slice(1, 6);

    // Calculate market stats
    const avgPrice = properties.reduce((sum, p) => sum + (parseFloat(p.price) || 0), 0) / properties.length;
    const avgSqft = properties.reduce((sum, p) => sum + (parseFloat(p.sqft) || parseFloat(p.livingArea) || 0), 0) / properties.length;
    const avgPriceSqft = avgSqft > 0 ? avgPrice / avgSqft : 0;

    // Estimate rental using 0.8% rule
    const subjectPrice = parseFloat(subject.price) || 500000;
    const estimatedMonthlyRent = Math.round(subjectPrice * 0.008);
    const estimatedCapRate = (estimatedMonthlyRent * 12) / subjectPrice * 100;

    // Build response
    const response = {
      subject: {
        address: subject.address || subject.addressString || 'N/A',
        beds: subject.beds || subject.bedrooms || 'N/A',
        baths: subject.baths || subject.bathrooms || 'N/A',
        sqft: subject.sqft || subject.livingArea || 'N/A',
        listPrice: Math.round(subjectPrice),
        url: subject.url || ''
      },
      market: {
        avgPrice: Math.round(avgPrice),
        avgPriceSqft: Math.round(avgPriceSqft * 100) / 100,
        totalProperties: properties.length
      },
      comparable_sales: comps.map(p => ({
        address: p.address || p.addressString || 'N/A',
        beds: p.beds || p.bedrooms || 'N/A',
        baths: p.baths || p.bathrooms || 'N/A',
        sqft: p.sqft || p.livingArea || 0,
        price: Math.round(parseFloat(p.price) || 0),
        pricePerSqft: (p.sqft || p.livingArea) 
          ? Math.round((parseFloat(p.price) / (p.sqft || p.livingArea)) * 100) / 100 
          : 0
      })),
      rental_market: {
        estimatedMonthlyRent: estimatedMonthlyRent,
        estimatedAnnualRent: estimatedMonthlyRent * 12,
        estimatedCapRate: Math.round(estimatedCapRate * 100) / 100
      },
      metadata: {
        searchAddress: address,
        timestamp: new Date().toISOString(),
        propertiesReturned: properties.length
      }
    };

    return res.status(200).json(response);

  } catch (error) {
    console.error('[ERROR]', error.message);

    let errorMsg = error.message;
    let statusCode = 500;

    if (error.message.includes('401') || error.message.includes('Unauthorized')) {
      errorMsg = 'API Key invalid or expired';
      statusCode = 401;
    } else if (error.message.includes('429') || error.message.includes('quota')) {
      errorMsg = 'Rate limit or quota exceeded on RapidAPI';
      statusCode = 429;
    } else if (error.message.includes('timeout')) {
      errorMsg = 'API request timeout';
      statusCode = 504;
    } else if (error.response?.status === 404) {
      errorMsg = 'Endpoint not found - check RapidAPI subscription';
      statusCode = 404;
    }

    return res.status(statusCode).json({
      error: errorMsg,
      debug: error.message
    });
  }
}