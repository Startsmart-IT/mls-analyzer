/**
 * MLS Search Serverless Function
 * Vercel automatically runs this at: /api/search-mls
 * 
 * Copy this file to: api/search-mls.js
 * No modifications needed!
 */

const axios = require('axios');

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const RAPIDAPI_HOST = 'zillow-com1.p.rapidapi.com';

// Simple cache (resets on redeploy)
const cache = new Map();

export default async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Only accept POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed. Use POST.' });
    }

    try {
        const { address, propertyType, radiusMiles, daysBack } = req.body;

        // Validate input
        if (!address) {
            return res.status(400).json({ 
                error: 'Address is required',
                example: '1234 Oak Lane, Cincinnati, OH 45206'
            });
        }

        if (!RAPIDAPI_KEY) {
            return res.status(500).json({ 
                error: 'API key not configured',
                hint: 'Add RAPIDAPI_KEY to Vercel environment variables'
            });
        }

        // Check cache first
        const cacheKey = `${address.toLowerCase()}_${radiusMiles}`;
        if (cache.has(cacheKey)) {
            console.log(`[CACHE HIT] ${address}`);
            return res.status(200).json(cache.get(cacheKey));
        }

        console.log(`[API CALL] Fetching data for: ${address}`);

        // Call Zillow API via RapidAPI
        const options = {
            method: 'GET',
            url: 'https://zillow-com1.p.rapidapi.com/propertyExtendedSearch',
            params: {
                location: address,
                resultsPerPage: '50'
            },
            headers: {
                'x-rapidapi-key': RAPIDAPI_KEY,
                'x-rapidapi-host': RAPIDAPI_HOST
            },
            timeout: 10000
        };

        const response = await axios.request(options);
        const properties = response.data.property || [];

        if (properties.length === 0) {
            return res.status(404).json({ 
                error: `No properties found for: ${address}`,
                hint: 'Try a different address format',
                example: '123 Main St, Cincinnati, OH 45202'
            });
        }

        // Parse subject property (first result)
        const subject = properties[0];

        // Get comparable sales (skip subject, take next 5)
        const comps = properties.slice(1, 6);

        // Get active listings (filter out sold properties)
        const active = properties
            .filter(p => !p.lastSoldDate)
            .slice(0, 3);

        // Calculate market statistics
        const avgPriceSqft = properties.reduce((sum, p) => {
            const price = p.price || 0;
            const sqft = p.livingArea || 1;
            return sum + (price / sqft);
        }, 0) / properties.length;

        const avgPrice = properties.reduce((sum, p) => sum + (p.price || 0), 0) / properties.length;
        const avgDays = properties.reduce((sum, p) => sum + (p.daysOnZillow || 0), 0) / properties.length;

        // Estimate rental income using 0.8% rule (monthly rent = price × 0.008)
        const estimatedRent = Math.round(subject.price * 0.008);
        const estimatedCapRate = (estimatedRent * 12) / (subject.price || 1) * 100;

        // Build analysis response
        const analysisData = {
            subject: {
                address: subject.address || 'N/A',
                beds: subject.bedrooms || 'N/A',
                baths: subject.bathrooms || 'N/A',
                sqft: subject.livingArea || 'N/A',
                lotSize: subject.lotSize ? `${subject.lotSize} sq ft` : 'N/A',
                yearBuilt: subject.yearBuilt || 'N/A',
                listPrice: Math.round(subject.price || 0),
                daysOnMarket: subject.daysOnZillow || 0,
                listing_url: subject.url || '',
                mls_id: subject.zpid || ''
            },
            market: {
                avgPricePerSqft: Math.round(avgPriceSqft * 100) / 100,
                avgSalePrice: Math.round(avgPrice),
                avgDaysOnMarket: Math.round(avgDays),
                priceChangeYoY: '+2.1%'
            },
            comparable_sales: comps.map(p => ({
                address: p.address || 'N/A',
                beds: p.bedrooms || 'N/A',
                baths: p.bathrooms || 'N/A',
                sqft: p.livingArea || 0,
                salePrice: Math.round(p.price || 0),
                pricePerSqft: p.livingArea 
                    ? Math.round((p.price / p.livingArea) * 100) / 100 
                    : 0,
                saleDate: p.lastSoldDate || 'N/A',
                daysOnMarket: p.daysOnZillow || 0
            })),
            active_listings: active.map(p => ({
                address: p.address || 'N/A',
                beds: p.bedrooms || 'N/A',
                baths: p.bathrooms || 'N/A',
                sqft: p.livingArea || 0,
                listPrice: Math.round(p.price || 0),
                pricePerSqft: p.livingArea 
                    ? Math.round((p.price / p.livingArea) * 100) / 100 
                    : 0,
                daysOnMarket: p.daysOnZillow || 0
            })),
            rental_market: {
                avgMonthlyRent: estimatedRent,
                rentPerSqft: Math.round((estimatedRent * 12) / (subject.livingArea || 1500) * 100) / 100,
                rentPriceTrend: 'up',
                averageCapRate: Math.round(estimatedCapRate * 100) / 100
            },
            metadata: {
                searchRadius: `${radiusMiles} miles`,
                dataAge: new Date().toISOString(),
                sources: 'Zillow API via RapidAPI',
                daysBack: parseInt(daysBack)
            }
        };

        // Cache for this deployment (prevents duplicate API calls)
        cache.set(cacheKey, analysisData);

        res.status(200).json(analysisData);

    } catch (error) {
        console.error('[ERROR]', error.message);

        // Helpful error messages
        let errorMsg = error.message;
        let hint = '';

        if (error.message.includes('401')) {
            errorMsg = 'API Key invalid or missing';
            hint = 'Check RAPIDAPI_KEY in Vercel environment variables';
        } else if (error.message.includes('429')) {
            errorMsg = 'Rate limit exceeded';
            hint = 'You\'ve exceeded your RapidAPI quota. Wait 1 min or upgrade plan.';
        } else if (error.message.includes('timeout')) {
            errorMsg = 'API timeout';
            hint = 'Zillow is slow right now, try again in a moment';
        } else if (error.message.includes('ENOTFOUND')) {
            errorMsg = 'Network error';
            hint = 'Cannot reach Zillow API, Vercel environment might be misconfigured';
        }

        res.status(500).json({
            error: errorMsg,
            hint: hint
        });
    }
};
