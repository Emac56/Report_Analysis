require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const { db } = require('./firebase');

const app = express();
const PORT = process.env.PORT || 3000;

// ========== MIDDLEWARE ==========
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'psau-secret-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// ========== AI ANALYSIS (Pollinations AI — no API key required) ==========
const aiReportCache = new Map();
console.log(' AI initialized via Pollinations (GPT-4o, no API key required).');

async function callAI(prompt, systemPrompt) {
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });

    const response = await fetch('https://text.pollinations.ai/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            messages,
            model: 'openai',
            seed: 42,
            private: true
        })
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`AI API error ${response.status}: ${errText}`);
    }
    const text = await response.text();
    return text.trim();
}

function stripSignature(htmlOrMarkdown) {
    if (!htmlOrMarkdown) return '';
    return htmlOrMarkdown
        .replace(/(?:^|\n|<br>|>)?\s*(?:<strong>|<b>|<\/?strong>|<\/?b>|\*\*|#*)*\s*(?:Reviewed\s*(?:and|&)\s*Approved|Approved|Reviewed|Prepared|Submitted)\s*by:?[\s\S]*$/gi, '')
        .replace(/(?:^|\n|<br>|>)?\s*(?:<strong>|<b>|<\/?strong>|<\/?b>|\*\*|#*)*\s*(?:\[?Signature\]?|Head,\s*OQA)[\s\S]*$/gi, '')
        .trim();
}

async function analyzeWithAI(feedbacks, officeName) {
    if (feedbacks.length === 0) return '';

    // Build a summary of the feedback data
    const sqdFields = ['sqd0', 'sqd1', 'sqd2', 'sqd3', 'sqd4', 'sqd5', 'sqd6', 'sqd7', 'sqd8'];
    const sqdLabels = [
        'SQD0 - Overall Satisfaction with Service',
        'SQD1 - Reasonableness of Processing Time',
        'SQD2 - Compliance with Document Requirements',
        'SQD3 - Simplicity of Processing Steps & Payment',
        'SQD4 - Accessibility of Information',
        'SQD5 - Reasonableness of Fees',
        'SQD6 - Fairness and Equal Treatment',
        'SQD7 - Staff Courtesy, Helpfulness & Professionalism',
        'SQD8 - Fulfillment of Service Outcome'
    ];

    // Calculate averages
    const sqdAvgs = sqdFields.map((field, i) => {
        const vals = feedbacks.map(f => parseFloat(f[field])).filter(v => !isNaN(v));
        const avg = vals.length > 0 ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) : 'N/A';
        return `${sqdLabels[i]}: ${avg}/5`;
    });

    // Collect suggestions
    const suggestions = feedbacks
        .map(f => f.suggestions)
        .filter(s => s && typeof s === 'string' && s.trim().length > 0);

    // Collect unique offices if overall
    const officeScope = officeName
        ? `Office/Department: ${officeName}`
        : `Scope: ALL offices/departments (university-wide)\nUnique offices represented: ${[...new Set(feedbacks.map(f => f.tanggapan).filter(Boolean))].join(', ') || 'N/A'}`;

    const prompt = `You are the official AI Data Analyst for Pampanga State Agricultural University (PSAU), reporting to the Office of Institutional Quality Assurance (OQA).

IMPORTANT — MULTILINGUAL CAPABILITY: Client feedback/suggestions may be written in English, Tagalog (Filipino), or Kapampangan (the local language of Pampanga). You MUST understand, interpret, and analyze comments in ALL THREE languages accurately. When quoting or referencing client comments in your report, provide the original text and, if not in English, include a brief English translation in parentheses for clarity.

Generate a formal, professional Customer Feedback Analysis Report based on the data below.

=== DATA ===
Report Date: ${new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}
${officeScope}
Total Respondents: ${feedbacks.length}

Service Quality Dimension (SQD) Ratings (Scale: 1-5, where 5 = Lubos na Sumasang-ayon / Strongly Agree):
${sqdAvgs.join('\n')}

Client Comments/Suggestions (${suggestions.length} received):
${suggestions.length > 0 ? suggestions.map((s, i) => `${i + 1}. "${s}"`).join('\n') : 'No written suggestions were provided.'}

=== REPORT FORMAT ===
Structure the report with the following sections. Use professional language and data-driven insights:

1. **Executive Summary** — 2-3 sentence overview of service quality performance and overall client satisfaction level.

2. **Key Performance Highlights** — Top-performing SQD dimensions (scores ≥ 4.0). Explain why these are strengths.

3. **Areas Requiring Attention** — SQD dimensions scoring below 4.0 or the lowest-performing areas. Provide context on potential causes.

4. **Client Sentiment Analysis** — Analyze the tone and themes from client suggestions/comments. Identify recurring topics or concerns.

5. **Actionable Recommendations** — Provide 3-5 specific, implementable recommendations that the ${officeName || 'university administration'} can act on to improve service delivery.

6. **Overall Rating Classification** — Classify overall performance as one of: Outstanding (4.5-5.0), Very Satisfactory (4.0-4.49), Satisfactory (3.5-3.99), Needs Improvement (3.0-3.49), or Poor (below 3.0).

Keep the report concise, data-driven, and formatted with bullet points for clarity. Write in professional English suitable for an institutional quality assurance report.
IMPORTANT: DO NOT include any signature blocks, sign-off lines, "Reviewed and Approved by", or placeholders for signatures at the end of the report. The report must end immediately after the final analytical section.`;

    const systemPrompt = 'You are the official AI Data Analyst for Pampanga State Agricultural University (PSAU), reporting to the Office of Institutional Quality Assurance (OQA). You are fluent in English, Tagalog, and Kapampangan. Do not include any signature lines, sign-off sections, or approval blocks at the end of the generated report.';
    try {
        const responseText = await callAI(prompt, systemPrompt);
        return stripSignature(responseText);
    } catch (err) {
        console.error('AI Analysis error:', err.message);
        return '';
    }
}

// ========== HELPER: Compute Dashboard Data ==========
function computeDashboardData(feedbacks) {
    const sqdFields = ['sqd0', 'sqd1', 'sqd2', 'sqd3', 'sqd4', 'sqd5', 'sqd6', 'sqd7', 'sqd8'];

    // SQD averages
    const sqdAverages = sqdFields.map(field => {
        const vals = feedbacks.map(f => parseFloat(f[field])).filter(v => !isNaN(v));
        return vals.length > 0 ? parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)) : 0;
    });

    // Overall avg SQD
    const allSqd = sqdAverages.filter(v => v > 0);
    const avgSQD = allSqd.length > 0 ? (allSqd.reduce((a, b) => a + b, 0) / allSqd.length).toFixed(2) : '0.00';

    // Sentiment counts
    const sentimentCounts = { positive: 0, neutral: 0, negative: 0, mixed: 0 };
    feedbacks.forEach(f => {
        const s = (f.sentiment || 'neutral').toLowerCase();
        if (sentimentCounts[s] !== undefined) sentimentCounts[s]++;
        else sentimentCounts.neutral++;
    });

    const total = feedbacks.length || 1;
    const positivePct = Math.round((sentimentCounts.positive / total) * 100);

    // CC1 counts
    const ccCounts = { cc1_1: 0, cc1_2: 0, cc1_3: 0, cc1_4: 0 };
    feedbacks.forEach(f => {
        const v = f.cc1;
        if (v === '1') ccCounts.cc1_1++;
        else if (v === '2') ccCounts.cc1_2++;
        else if (v === '3') ccCounts.cc1_3++;
        else if (v === '4') ccCounts.cc1_4++;
    });

    // Gender counts
    const genderCounts = { lalaki: 0, babae: 0 };
    feedbacks.forEach(f => {
        const g = (f.kasarian || '').toLowerCase();
        if (g === 'lalaki') genderCounts.lalaki++;
        else if (g === 'babae') genderCounts.babae++;
    });

    // Count suggestions
    const totalSuggestions = feedbacks.filter(f => f.suggestions && f.suggestions.trim().length > 0).length;

    return {
        stats: { totalResponses: feedbacks.length, avgSQD, positivePct, totalSuggestions },
        chartData: { sqdAverages, sentimentCounts, ccCounts, genderCounts }
    };
}

// Simple sentiment from SQD average as fallback
function determineSentimentFallback(data) {
    const sqdFields = ['sqd0', 'sqd1', 'sqd2', 'sqd3', 'sqd4', 'sqd5', 'sqd6', 'sqd7', 'sqd8'];
    const vals = sqdFields.map(f => parseFloat(data[f])).filter(v => !isNaN(v));
    if (vals.length === 0) return 'Neutral';
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    if (avg >= 4) return 'Positive';
    if (avg >= 3) return 'Neutral';
    if (avg >= 2) return 'Mixed';
    return 'Negative';
}

// Multilingual Sentiment Analysis (English, Tagalog, Kapampangan) via Pollinations AI
async function determineSentimentWithAI(comment, fallbackData) {
    if (!comment || typeof comment !== 'string' || comment.trim().length === 0) {
        return determineSentimentFallback(fallbackData);
    }
    try {
        const prompt = `Analyze the sentiment of the following customer feedback comment.
The comment may be in English, Tagalog (Filipino), or Kapampangan.
Classify it strictly as one of: Positive, Neutral, Negative, or Mixed.
Respond with ONLY one word — the classification. No punctuation, no explanation.

Comment: "${comment}"`;
        const responseText = await callAI(prompt);
        if (/positive/i.test(responseText)) return 'Positive';
        if (/negative/i.test(responseText)) return 'Negative';
        if (/mixed/i.test(responseText)) return 'Mixed';
        if (/neutral/i.test(responseText)) return 'Neutral';
        return determineSentimentFallback(fallbackData);
    } catch (err) {
        console.error('AI Sentiment analysis failed, using fallback:', err.message);
        return determineSentimentFallback(fallbackData);
    }
}

// K-Means Clustering for rating pattern analysis of departments/offices
function runKMeansClustering(feedbacks) {
    const deptData = {};
    const sqdFields = ['sqd0', 'sqd1', 'sqd2', 'sqd3', 'sqd4', 'sqd5', 'sqd6', 'sqd7', 'sqd8'];

    feedbacks.forEach(f => {
        if (!f.tanggapan) return;
        const dept = f.tanggapan.trim();
        if (!deptData[dept]) {
            deptData[dept] = {
                name: dept,
                ratings: Array.from({ length: 9 }, () => []),
                count: 0
            };
        }
        
        sqdFields.forEach((field, idx) => {
            const val = parseFloat(f[field]);
            if (!isNaN(val)) {
                deptData[dept].ratings[idx].push(val);
            }
        });
        deptData[dept].count++;
    });

    const departmentsList = [];
    Object.keys(deptData).forEach(name => {
        const dept = deptData[name];
        const features = dept.ratings.map(arr => {
            if (arr.length === 0) return 3.0; // Neutral default
            return arr.reduce((a, b) => a + b, 0) / arr.length;
        });
        departmentsList.push({ name, features });
    });

    if (departmentsList.length === 0) return [];

    const K = 3;
    const actualK = Math.min(K, departmentsList.length);
    
    // Pick initial centroids from the dataset at intervals
    let centroids = [];
    const step = Math.floor(departmentsList.length / actualK);
    for (let i = 0; i < actualK; i++) {
        centroids.push([...departmentsList[i * step].features]);
    }

    let assignments = new Array(departmentsList.length).fill(-1);
    let changed = true;
    let iterations = 0;
    const maxIterations = 50;

    const distance = (a, b) => {
        let sum = 0;
        for (let i = 0; i < a.length; i++) {
            sum += Math.pow((a[i] || 0) - (b[i] || 0), 2);
        }
        return Math.sqrt(sum);
    };

    while (changed && iterations < maxIterations) {
        changed = false;
        iterations++;

        for (let i = 0; i < departmentsList.length; i++) {
            const features = departmentsList[i].features;
            let minDist = Infinity;
            let closestCentroidIdx = -1;

            for (let c = 0; c < actualK; c++) {
                const dist = distance(features, centroids[c]);
                if (dist < minDist) {
                    minDist = dist;
                    closestCentroidIdx = c;
                }
            }

            if (assignments[i] !== closestCentroidIdx) {
                assignments[i] = closestCentroidIdx;
                changed = true;
            }
        }

        const newCentroids = Array.from({ length: actualK }, () => new Array(9).fill(0));
        const counts = new Array(actualK).fill(0);

        for (let i = 0; i < departmentsList.length; i++) {
            const clusterIdx = assignments[i];
            const features = departmentsList[i].features;
            counts[clusterIdx]++;
            for (let d = 0; d < 9; d++) {
                newCentroids[clusterIdx][d] += features[d];
            }
        }

        for (let c = 0; c < actualK; c++) {
            if (counts[c] > 0) {
                for (let d = 0; d < 9; d++) {
                    newCentroids[c][d] /= counts[c];
                }
                centroids[c] = newCentroids[c];
            }
        }
    }

    const centroidSums = centroids.map((c, idx) => ({
        idx,
        sum: c.reduce((a, b) => a + b, 0)
    }));
    centroidSums.sort((a, b) => a.sum - b.sum);

    const labelMapping = {};
    centroidSums.forEach((item, index) => {
        if (actualK === 3) {
            if (index === 0) labelMapping[item.idx] = 'Needs Attention (Low Avg Ratings)';
            else if (index === 1) labelMapping[item.idx] = 'Satisfactory Performance (Mid Avg)';
            else labelMapping[item.idx] = 'Outstanding Performance (High Avg)';
        } else if (actualK === 2) {
            if (index === 0) labelMapping[item.idx] = 'Needs Improvement';
            else labelMapping[item.idx] = 'Excellent Performance';
        } else {
            labelMapping[item.idx] = 'General Performance Cluster';
        }
    });

    return departmentsList.map((dept, i) => {
        const avgScore = (dept.features.reduce((a, b) => a + b, 0) / 9).toFixed(2);
        return {
            name: dept.name,
            avgScore,
            cluster: labelMapping[assignments[i]]
        };
    }).sort((a, b) => b.avgScore - a.avgScore);
}

// ========== AUTH MIDDLEWARE ==========
function requireAuth(req, res, next) {
    if (req.session && req.session.isAdmin) return next();
    res.redirect('/admin/login');
}

// ========== ROUTES ==========

// Public: Feedback Form
app.get('/', (req, res) => {
    res.render('form');
});

// Public: Submit Feedback
app.post('/submit-feedback', async (req, res) => {
    try {
        const data = req.body;

        // Calculate average SQD
        const sqdFields = ['sqd0', 'sqd1', 'sqd2', 'sqd3', 'sqd4', 'sqd5', 'sqd6', 'sqd7', 'sqd8'];
        const sqdVals = sqdFields.map(f => parseFloat(data[f])).filter(v => !isNaN(v));
        const avgSQD = sqdVals.length > 0 ? (sqdVals.reduce((a, b) => a + b, 0) / sqdVals.length).toFixed(2) : 'N/A';

        // Determine sentiment using Gemini AI with fallback
        const sentiment = await determineSentimentWithAI(data.suggestions, data);

        // Handle "Others" transaction type
        if (data.uri_transaksyon === 'Others' && data.others_specify) {
            data.uri_transaksyon = 'Others: ' + data.others_specify;
        }
        delete data.others_specify;

        // Save to Firestore
        const feedbackData = {
            ...data,
            avgSQD,
            sentiment,
            submittedAt: new Date().toISOString()
        };

        await db.collection('feedbacks').add(feedbackData);
        console.log(' Feedback saved successfully.');
        
        // Invalidate AI report cache
        aiReportCache.clear();

        res.redirect('/thank-you');
    } catch (err) {
        console.error('Error saving feedback:', err);
        res.status(500).send('Error saving feedback. Please try again.');
    }
});

// Public: Thank you page
app.get('/thank-you', (req, res) => {
    res.render('thank-you');
});

// Admin: Login page
app.get('/admin/login', (req, res) => {
    if (req.session && req.session.isAdmin) return res.redirect('/admin/dashboard');
    res.render('login', { error: null });
});

// Admin: Login action
app.post('/admin/login', async (req, res) => {
    const { email, password } = req.body;
    const apiKey = process.env.FIREBASE_API_KEY;

    if (!apiKey) {
        return res.render('login', { error: 'Firebase API Key is missing in server configuration.' });
    }

    try {
        const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email,
                password,
                returnSecureToken: true
            })
        });

        const data = await response.json();

        if (response.ok) {
            req.session.isAdmin = true;
            req.session.adminUser = data.email;
            res.redirect('/admin/dashboard');
        } else {
            const errMsg = data.error?.message || '';
            let friendlyMsg = 'Invalid email or password.';
            if (errMsg === 'USER_DISABLED') {
                friendlyMsg = 'This account has been disabled.';
            } else if (errMsg === 'TOO_MANY_ATTEMPTS_TRY_LATER') {
                friendlyMsg = 'Too many failed login attempts. Please try again later.';
            }
            res.render('login', { error: friendlyMsg });
        }
    } catch (err) {
        console.error('Firebase Auth error:', err);
        res.render('login', { error: 'Authentication service error. Please try again later.' });
    }
});

// Admin: Logout
app.get('/admin/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin/login');
});

// ========== HELPERS: Date & Filter ==========
function parseDateParam(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
}

function filterByDateRange(feedbacks, dateFrom, dateTo) {
    return feedbacks.filter(f => {
        if (!f.submittedAt) return true;
        const d = new Date(f.submittedAt);
        if (isNaN(d.getTime())) return true;
        if (dateFrom && d < dateFrom) return false;
        if (dateTo) {
            const endOfDay = new Date(dateTo);
            endOfDay.setHours(23, 59, 59, 999);
            if (d > endOfDay) return false;
        }
        return true;
    });
}

// Admin: Dashboard
app.get('/admin/dashboard', requireAuth, async (req, res) => {
    try {
        // Fetch all feedbacks
        const snapshot = await db.collection('feedbacks').get();
        const allFeedbacks = [];
        snapshot.docs.forEach(doc => {
            allFeedbacks.push({ id: doc.id, ...doc.data() });
        });

        // Extract unique office names for the filter dropdown
        const officeSet = new Set();
        allFeedbacks.forEach(f => {
            if (f.tanggapan && typeof f.tanggapan === 'string' && f.tanggapan.trim().length > 0) {
                officeSet.add(f.tanggapan.trim());
            }
        });
        const availableOffices = [...officeSet].sort();

        // Read filter params
        const selectedOffice = req.query.office || 'all';
        const dateFrom = parseDateParam(req.query.dateFrom);
        const dateTo = parseDateParam(req.query.dateTo);

        // Apply date filter first
        let feedbacks = filterByDateRange(allFeedbacks, dateFrom, dateTo);

        // Then apply office filter
        if (selectedOffice && selectedOffice !== 'all') {
            feedbacks = feedbacks.filter(f => f.tanggapan === selectedOffice);
        }

        // Compute chart/stats data
        const { stats, chartData } = computeDashboardData(feedbacks);

        // Run K-Means Clustering on overall feedbacks to group departments
        const clusteredDepartments = runKMeansClustering(allFeedbacks);

        // Retrieve from cache if available
        const cacheKey = `${selectedOffice}_${req.query.dateFrom || ''}_${req.query.dateTo || ''}`;
        const aiAnalysis = aiReportCache.get(cacheKey) || '';

        res.render('dashboard', {
            feedbacks,
            allFeedbacks,
            stats,
            chartData,
            aiAnalysis,
            availableOffices,
            selectedOffice,
            clusteredDepartments,
            dateFrom: req.query.dateFrom || '',
            dateTo: req.query.dateTo || ''
        });
    } catch (err) {
        console.error('Dashboard error:', err);
        res.status(500).send('Error loading dashboard.');
    }
});

// Admin: Generate AI Report (AJAX endpoint to reduce API usage)
app.get('/admin/generate-ai-report', requireAuth, async (req, res) => {
    try {
        const selectedOffice = req.query.office || 'all';
        const cacheKey = `${selectedOffice}_${req.query.dateFrom || ''}_${req.query.dateTo || ''}`;

        // Return from cache if we aren't forcing a refresh
        if (req.query.refresh !== 'true' && aiReportCache.has(cacheKey)) {
            return res.json({ success: true, aiAnalysis: stripSignature(aiReportCache.get(cacheKey)) });
        }

        const snapshot = await db.collection('feedbacks').get();
        const allFeedbacks = [];
        snapshot.docs.forEach(doc => {
            allFeedbacks.push({ id: doc.id, ...doc.data() });
        });

        const dateFrom = parseDateParam(req.query.dateFrom);
        const dateTo = parseDateParam(req.query.dateTo);

        let feedbacks = filterByDateRange(allFeedbacks, dateFrom, dateTo);

        if (selectedOffice && selectedOffice !== 'all') {
            feedbacks = feedbacks.filter(f => f.tanggapan === selectedOffice);
        }

        if (feedbacks.length === 0) {
            return res.json({ success: false, error: 'Walang naisumiteng feedback para sa napiling criteria.' });
        }

        const officeName = selectedOffice !== 'all' ? selectedOffice : null;
        let aiAnalysis = await analyzeWithAI(feedbacks, officeName);

        if (!aiAnalysis) {
            return res.json({ success: false, error: 'Gemini AI returned empty content. Please verify your API Key and rate limits, then try again.' });
        }

        // Convert markdown to HTML
        aiAnalysis = aiAnalysis
            .replace(/\\*\\*(.*?)\\*\\*/g, '<strong>$1</strong>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');

        // Save to cache
        aiReportCache.set(cacheKey, aiAnalysis);

        res.json({ success: true, aiAnalysis: stripSignature(aiAnalysis) });
    } catch (err) {
        console.error('Error generating AI report:', err);
        res.json({ success: false, error: 'Failed to generate AI report: ' + err.message });
    }
});

// Admin: Print AI Report (printable summary of AI analysis)
app.get('/admin/print-ai-report', requireAuth, async (req, res) => {
    try {
        const selectedOffice = req.query.office || 'all';
        const cacheKey = `${selectedOffice}_${req.query.dateFrom || ''}_${req.query.dateTo || ''}`;

        let aiAnalysis = stripSignature(aiReportCache.get(cacheKey) || '');

        // If not in cache, generate it on the fly
        if (!aiAnalysis) {
            const snapshot = await db.collection('feedbacks').get();
            const allFeedbacks = [];
            snapshot.docs.forEach(doc => {
                allFeedbacks.push({ id: doc.id, ...doc.data() });
            });

            const dateFrom = parseDateParam(req.query.dateFrom);
            const dateTo = parseDateParam(req.query.dateTo);

            let feedbacks = filterByDateRange(allFeedbacks, dateFrom, dateTo);

            if (selectedOffice && selectedOffice !== 'all') {
                feedbacks = feedbacks.filter(f => f.tanggapan === selectedOffice);
            }

            if (feedbacks.length > 0) {
                const officeName = selectedOffice !== 'all' ? selectedOffice : null;
                aiAnalysis = await analyzeWithAI(feedbacks, officeName);
                if (aiAnalysis) {
                    // Convert markdown to HTML
                    aiAnalysis = aiAnalysis
                        .replace(/\\*\\*(.*?)\\*\\*/g, '<strong>$1</strong>')
                        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                        .replace(/\n/g, '<br>');
                    // Save to cache
                    aiReportCache.set(cacheKey, aiAnalysis);
                }
            }
        }

        // Clean & sanitize the HTML content to remove any links or potential vulnerability vectors
        const cleanAiAnalysis = (aiAnalysis || '')
            .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1') // remove <a> but keep content
            .replace(/\shref\s*=\s*(['"]).*?\1/gi, '')    // remove any href attributes
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // remove scripts
            .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '');  // remove inline event handlers

        res.render('print-ai-report', {
            officeName: selectedOffice !== 'all' ? selectedOffice : 'All Offices / Departments (University-Wide)',
            dateFrom: req.query.dateFrom || '',
            dateTo: req.query.dateTo || '',
            aiAnalysisCleaned: cleanAiAnalysis,
            generatedAt: new Date().toLocaleString('en-PH', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        });
    } catch (err) {
        console.error('Print AI Report error:', err);
        res.status(500).send('Error generating print view for AI report.');
    }
});

// Admin: Detailed Report (printable)
app.get('/admin/report', requireAuth, async (req, res) => {
    try {
        const snapshot = await db.collection('feedbacks').get();
        const allFeedbacks = [];
        snapshot.docs.forEach(doc => {
            allFeedbacks.push({ id: doc.id, ...doc.data() });
        });

        const selectedOffice = req.query.office || 'all';
        const dateFrom = parseDateParam(req.query.dateFrom);
        const dateTo = parseDateParam(req.query.dateTo);

        let feedbacks = filterByDateRange(allFeedbacks, dateFrom, dateTo);

        if (selectedOffice && selectedOffice !== 'all') {
            feedbacks = feedbacks.filter(f => f.tanggapan === selectedOffice);
        }

        const { stats, chartData } = computeDashboardData(feedbacks);

        res.render('report', {
            feedbacks,
            stats,
            chartData,
            selectedOffice,
            dateFrom: req.query.dateFrom || '',
            dateTo: req.query.dateTo || '',
            generatedAt: new Date().toLocaleString('en-PH', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        });
    } catch (err) {
        console.error('Report error:', err);
        res.status(500).send('Error generating report.');
    }
});

// ========== START SERVER ==========
const server = app.listen(PORT, () => {
    console.log(`\n PSAU Feedback System running on http://localhost:${PORT}`);
    console.log(`    Form:      http://localhost:${PORT}/`);
    console.log(`    Admin:     http://localhost:${PORT}/admin/login`);
    console.log(`    Dashboard: http://localhost:${PORT}/admin/login\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Server shutting down...');
    server.close(() => process.exit(0));
});
