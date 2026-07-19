const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');

let activeDb;
let useFirebase = false;
const mockFeedbacks = [];

// Define mock DB
const mockDb = {
    collection: (name) => ({
        add: async (data) => {
            const id = 'mock_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            const entry = { id, ...data, createdAt: new Date() };
            mockFeedbacks.push(entry);
            return { id };
        },
        doc: (id) => ({
            get: async () => {
                const found = mockFeedbacks.find(f => f.id === id);
                return { exists: !!found, data: () => found, id };
            },
            update: async (data) => {
                const idx = mockFeedbacks.findIndex(f => f.id === id);
                if (idx !== -1) mockFeedbacks[idx] = { ...mockFeedbacks[idx], ...data };
            },
            set: async (data, options) => {
                const idx = mockFeedbacks.findIndex(f => f.id === id);
                if (idx !== -1) {
                    mockFeedbacks[idx] = options?.merge 
                        ? { ...mockFeedbacks[idx], ...data } 
                        : { id, ...data };
                } else {
                    mockFeedbacks.push({ id, ...data });
                }
            }
        }),
        get: async () => ({
            docs: mockFeedbacks.map(f => ({
                id: f.id,
                data: () => f
            })),
            size: mockFeedbacks.length,
            empty: mockFeedbacks.length === 0
        }),
        orderBy: function() { return this; },
        limit: function() { return this; },
        where: function() { return this; }
    })
};

let serviceAccount;
const envServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
if (envServiceAccount) {
    try {
        serviceAccount = JSON.parse(envServiceAccount);
    } catch (e) {
        console.log('⚠️  Failed to parse FIREBASE_SERVICE_ACCOUNT env var:', e.message);
    }
}
if (!serviceAccount) {
    try {
        serviceAccount = require('./serviceAccountKey.json');
    } catch (e) {
        console.log('⚠️  No service account file found (serviceAccountKey.json).');
    }
}

if (serviceAccount) {
    try {
        const app = admin.initializeApp({
            credential: admin.cert(serviceAccount)
        });
        const realDb = getFirestore(app);
        activeDb = realDb;
        useFirebase = true;
        console.log('✅ Firebase initialized successfully.');
    } catch (error) {
        console.log('⚠️  Firebase init failed. Using in-memory mock database.');
        console.log('   Error:', error.message);
        activeDb = mockDb;
        useFirebase = false;
    }
}

// Wrapper to handle runtime Firestore errors (like disabled API or permission denied)
const db = {
    collection: (name) => {
        return {
            add: async (data) => {
                try {
                    return await activeDb.collection(name).add(data);
                } catch (error) {
                    if (useFirebase && (error.code === 7 || error.message.includes('PERMISSION_DENIED') || error.message.includes('API has not been used'))) {
                        console.error('\n⚠️  Firestore API is disabled or permission was denied in your Firebase project!');
                        console.error('   Please enable the Cloud Firestore API by visiting the URL in the error message.');
                        console.error('   Switching to the in-memory mock database to keep the app running...\n');
                        useFirebase = false;
                        activeDb = mockDb;
                        return await activeDb.collection(name).add(data);
                    }
                    throw error;
                }
            },
            doc: (id) => {
                return {
                    get: async () => {
                        try {
                            return await activeDb.collection(name).doc(id).get();
                        } catch (error) {
                            if (useFirebase && (error.code === 7 || error.message.includes('PERMISSION_DENIED') || error.message.includes('API has not been used'))) {
                                console.error('\n⚠️  Firestore API is disabled or permission was denied in your Firebase project!');
                                console.error('   Switching to mock database...\n');
                                useFirebase = false;
                                activeDb = mockDb;
                                return await activeDb.collection(name).doc(id).get();
                            }
                            throw error;
                        }
                    },
                    update: async (data) => {
                        try {
                            return await activeDb.collection(name).doc(id).update(data);
                        } catch (error) {
                            if (useFirebase && (error.code === 7 || error.message.includes('PERMISSION_DENIED') || error.message.includes('API has not been used'))) {
                                useFirebase = false;
                                activeDb = mockDb;
                                return await activeDb.collection(name).doc(id).update(data);
                            }
                            throw error;
                        }
                    },
                    set: async (data, options) => {
                        try {
                            return await activeDb.collection(name).doc(id).set(data, options);
                        } catch (error) {
                            if (useFirebase && (error.code === 7 || error.message.includes('PERMISSION_DENIED') || error.message.includes('API has not been used'))) {
                                useFirebase = false;
                                activeDb = mockDb;
                                return await activeDb.collection(name).doc(id).set(data, options);
                            }
                            throw error;
                        }
                    }
                };
            },
            get: async () => {
                try {
                    return await activeDb.collection(name).get();
                } catch (error) {
                    if (useFirebase && (error.code === 7 || error.message.includes('PERMISSION_DENIED') || error.message.includes('API has not been used'))) {
                        console.error('\n⚠️  Firestore API is disabled or permission was denied in your Firebase project!');
                        console.error('   Please enable the Cloud Firestore API by visiting the URL in the error message.');
                        console.error('   Switching to the in-memory mock database to keep the app running...\n');
                        useFirebase = false;
                        activeDb = mockDb;
                        return await activeDb.collection(name).get();
                    }
                    throw error;
                }
            },
            orderBy: function(...args) {
                if (useFirebase) {
                    try {
                        const chain = activeDb.collection(name).orderBy(...args);
                        const originalGet = chain.get;
                        chain.get = async () => {
                            try {
                                return await originalGet.call(chain);
                            } catch (error) {
                                if (useFirebase && (error.code === 7 || error.message.includes('PERMISSION_DENIED') || error.message.includes('API has not been used'))) {
                                    useFirebase = false;
                                    activeDb = mockDb;
                                    return await activeDb.collection(name).get();
                                }
                                throw error;
                            }
                        };
                        return chain;
                    } catch (error) {
                        useFirebase = false;
                        activeDb = mockDb;
                    }
                }
                return mockDb.collection(name).orderBy(...args);
            },
            limit: function(...args) {
                if (useFirebase) {
                    try {
                        const chain = activeDb.collection(name).limit(...args);
                        const originalGet = chain.get;
                        chain.get = async () => {
                            try {
                                return await originalGet.call(chain);
                            } catch (error) {
                                if (useFirebase && (error.code === 7 || error.message.includes('PERMISSION_DENIED') || error.message.includes('API has not been used'))) {
                                    useFirebase = false;
                                    activeDb = mockDb;
                                    return await activeDb.collection(name).get();
                                }
                                throw error;
                            }
                        };
                        return chain;
                    } catch (error) {
                        useFirebase = false;
                        activeDb = mockDb;
                    }
                }
                return mockDb.collection(name).limit(...args);
            },
            where: function(...args) {
                if (useFirebase) {
                    try {
                        const chain = activeDb.collection(name).where(...args);
                        const originalGet = chain.get;
                        chain.get = async () => {
                            try {
                                return await originalGet.call(chain);
                            } catch (error) {
                                if (useFirebase && (error.code === 7 || error.message.includes('PERMISSION_DENIED') || error.message.includes('API has not been used'))) {
                                    useFirebase = false;
                                    activeDb = mockDb;
                                    return await activeDb.collection(name).get();
                                }
                                throw error;
                            }
                        };
                        return chain;
                    } catch (error) {
                        useFirebase = false;
                        activeDb = mockDb;
                    }
                }
                return mockDb.collection(name).where(...args);
            }
        };
    }
};

module.exports = { db, useFirebase: () => useFirebase };
