const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { MongoClient } = require('mongodb');
const crypto = require('crypto');
const zlib = require('zlib');
const shortid = require('shortid');
const path = require('path');

const app = express();
const server = createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ['GET', 'POST'] }
});

// Configuration
const PORT = process.env.PORT || 5829;
const MONGO_URI = process.env.MONGO_URI;
const SAVE_INTERVAL = 60000;
const CLEANUP_INTERVAL = 300000;

// In-memory storage
const editorData = new Map(); // { editorId: { content: string, lastSaved: timestamp, connections: Set } }
let mongoClient = null;
let db = null;

// Initialize MongoDB connection
async function initMongo() {
    if (!MONGO_URI) {
        console.warn('No MONGO_URI provided, running in memory-only mode');
        return;
    }
    try {
        mongoClient = new MongoClient(MONGO_URI);
        await mongoClient.connect();
        db = mongoClient.db('collaborative_editor');
        console.log('MongoDB connected');
    } catch (error) {
        console.error('MongoDB connection failed:', error);
    }
}

// Utility functions
const compress = (data) => zlib.deflateSync(Buffer.from(data));
const decompress = (data) => zlib.inflateSync(data).toString();

function encrypt(text) {
    if (!process.env.ENCRYPTION_KEY) return text; // Skip encryption if no key
    const key = crypto.scryptSync(process.env.ENCRYPTION_KEY, 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
    if (!process.env.ENCRYPTION_KEY) return text; // Skip decryption if no key
    const key = crypto.scryptSync(process.env.ENCRYPTION_KEY, 'salt', 32);
    const [ivHex, encryptedHex] = text.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

// Database operations
async function loadFromDB(editorId) {
    if (!db) return null;
    try {
        const collection = db.collection('editors');
        const result = await collection.findOne({ _id: editorId });
        if (!result) return null;
        
        const decrypted = decrypt(result.content);
        return decompress(Buffer.from(decrypted, 'base64'));
    } catch (error) {
        console.error('Load error:', error);
        return null;
    }
}

async function saveToDB(editorId, content) {
    if (!db || !content.trim()) return;
    try {
        const compressed = compress(content);
        const encrypted = encrypt(compressed.toString('base64'));
        
        const collection = db.collection('editors');
        await collection.updateOne(
            { _id: editorId },
            { $set: { _id: editorId, content: encrypted, updatedAt: new Date() } },
            { upsert: true }
        );
        
        // Update last saved timestamp
        const editor = editorData.get(editorId);
        if (editor) {
            editor.lastSaved = Date.now();
        }
    } catch (error) {
        console.error('Save error:', error);
    }
}

async function deleteFromDB(editorId) {
    if (!db) return;
    try {
        const collection = db.collection('editors');
        await collection.deleteOne({ _id: editorId });
    } catch (error) {
        console.error('Delete error:', error);
    }
}

// Memory management
function getOrCreateEditor(editorId) {
    if (!editorData.has(editorId)) {
        editorData.set(editorId, {
            content: '',
            lastSaved: 0,
            connections: new Set()
        });
    }
    return editorData.get(editorId);
}

function cleanupEditor(editorId) {
    const editor = editorData.get(editorId);
    if (editor && editor.connections.size === 0) {
        editorData.delete(editorId);
        console.log(`Cleaned up editor: ${editorId}`);
    }
}

// Batch save unsaved editors
async function batchSave() {
    const promises = [];
    const now = Date.now();
    
    for (const [editorId, editor] of editorData.entries()) {
        // Save if content changed and hasn't been saved recently
        if (editor.content.trim() && (now - editor.lastSaved) > SAVE_INTERVAL) {
            promises.push(saveToDB(editorId, editor.content));
        }
    }
    
    if (promises.length > 0) {
        await Promise.allSettled(promises);
        console.log(`Batch saved ${promises.length} editors`);
    }
}

// Cleanup inactive editors
function cleanupInactive() {
    let cleaned = 0;
    for (const [editorId] of editorData.entries()) {
        const editor = editorData.get(editorId);
        if (editor.connections.size === 0) {
            editorData.delete(editorId);
            cleaned++;
        }
    }
    if (cleaned > 0) {
        console.log(`Cleaned up ${cleaned} inactive editors`);
    }
}

// Express middleware
app.use(express.json());
app.use(express.static('public'));

// Health check endpoint
app.get('/health', (req, res) => {
    const health = {
        status: 'OK',
        timestamp: new Date().toISOString(),
        activeEditors: editorData.size,
        totalConnections: Array.from(editorData.values()).reduce((sum, editor) => sum + editor.connections.size, 0),
        mongodb: db ? 'connected' : 'disconnected'
    };
    res.json(health);
});

app.get('/editor', (req, res) => {
    if (req.query.id) {
        res.sendFile(path.join(__dirname, 'public', 'editor.html'));
    } else {
        const editorId = shortid.generate();
        res.redirect(`/editor?id=${editorId}`);
    }
});

app.get('/editor/load/:id', async (req, res) => {
    const { id } = req.params;
    const editor = getOrCreateEditor(id);
    
    // If no content in memory, try loading from DB
    if (!editor.content) {
        const dbContent = await loadFromDB(id);
        if (dbContent) {
            editor.content = dbContent;
        }
    }
    
    res.json({ success: true, content: editor.content });
});

app.post('/editor/save/:id', async (req, res) => {
    const { id } = req.params;
    const editor = editorData.get(id);
    
    if (editor && editor.content.trim()) {
        await saveToDB(id, editor.content);
        res.json({ success: true });
    } else {
        res.json({ success: false, error: 'No content to save' });
    }
});

app.delete('/editor/delete/:id', async (req, res) => {
    const { id } = req.params;
    
    // Remove from memory and database
    editorData.delete(id);
    await deleteFromDB(id);
    
    res.json({ success: true });
});

// Routes
app.get('/', (req, res) => {
    res.redirect('/editor');
});

// Socket.IO handling
io.on('connection', (socket) => {
    let currentEditorId = null;
    
    socket.on('join-editor', async (editorId) => {
        if (currentEditorId) {
            // Leave previous editor
            socket.leave(currentEditorId);
            const prevEditor = editorData.get(currentEditorId);
            if (prevEditor) {
                prevEditor.connections.delete(socket.id);
            }
        }
        
        currentEditorId = editorId;
        socket.join(editorId);
        
        const editor = getOrCreateEditor(editorId);
        editor.connections.add(socket.id);
        
        // Load content from DB if not in memory
        if (!editor.content) {
            const dbContent = await loadFromDB(editorId);
            if (dbContent) {
                editor.content = dbContent;
            }
        }
        
        // Send current content to the joining user
        socket.emit('content-update', editor.content);
        
        console.log(`Client ${socket.id} joined editor ${editorId} (${editor.connections.size} total)`);
    });
    
    socket.on('content-change', (content) => {
        if (!currentEditorId) return;
        
        const editor = editorData.get(currentEditorId);
        if (!editor) return;
        
        // Update content and broadcast to others
        editor.content = content;
        socket.to(currentEditorId).emit('content-update', content);
    });
    
    socket.on('disconnect', () => {
        if (currentEditorId) {
            const editor = editorData.get(currentEditorId);
            if (editor) {
                editor.connections.delete(socket.id);
                console.log(`Client ${socket.id} left editor ${currentEditorId} (${editor.connections.size} remaining)`);
                
                // If no connections left, save content
                if (editor.connections.size === 0 && editor.content.trim()) {
                    saveToDB(currentEditorId, editor.content);
                }
            }
        }
    });
});

// Background tasks
setInterval(batchSave, SAVE_INTERVAL);
setInterval(cleanupInactive, CLEANUP_INTERVAL);

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down gracefully...');
    
    // Save all editors before shutdown
    const savePromises = [];
    for (const [editorId, editor] of editorData.entries()) {
        if (editor.content.trim()) {
            savePromises.push(saveToDB(editorId, editor.content));
        }
    }
    
    await Promise.allSettled(savePromises);
    
    if (mongoClient) {
        await mongoClient.close();
    }
    
    process.exit(0);
});

// Start server
async function start() {
    await initMongo();
    server.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        // console.log(`Health check: http://localhost:${PORT}/health`);
        // console.log(`Editor URL: http://localhost:${PORT}/editor`);
    });
}

start().catch(console.error);