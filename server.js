/* ==========================================
   FASO GADGET - Serveur Backend avec MongoDB
   Authentification + Gestion Produits + Commandes
   ========================================== */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');

const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// MongoDB Configuration
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://julesrodriguesawadogo2_db_user:8MNvimcTtMepP7Mx@fasogadget.fzcjlak.mongodb.net/?appName=fasogadget';
const DB_NAME = 'fasogadget';

let db = null;

// Créer le dossier uploads s'il n'existe pas
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Types MIME
const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp'
};

// Sessions actives
const sessions = new Map();

// ==========================================
// CONNEXION MONGODB
// ==========================================

async function connectDB() {
    try {
        const client = new MongoClient(MONGODB_URI);
        await client.connect();
        db = client.db(DB_NAME);
        console.log('✅ Connecté à MongoDB Atlas');

        // Initialiser les données par défaut si nécessaire
        await initializeDB();
        return true;
    } catch (error) {
        console.error('❌ Erreur connexion MongoDB:', error.message);
        return false;
    }
}

async function initializeDB() {
    // Vérifier si config existe, sinon créer
    const config = await db.collection('config').findOne({ _id: 'admin' });
    if (!config) {
        await db.collection('config').insertOne({
            _id: 'admin',
            username: 'admin',
            password: 'admin'
        });
        console.log('📝 Configuration admin créée');
    }

    // Vérifier si des produits existent
    const productsCount = await db.collection('products').countDocuments();
    if (productsCount === 0) {
        const defaultProducts = [
            { name: "iPhone 15 Pro Max", category: "smartphone", price: 850000, image: "", badge: "Nouveau" },
            { name: "Samsung Galaxy S24 Ultra", category: "smartphone", price: 750000, image: "", badge: "Populaire" },
            { name: "Xiaomi 14 Pro", category: "smartphone", price: 450000, image: "", badge: "" },
            { name: "AirPods Pro 2", category: "audio", price: 150000, image: "", badge: "Best-seller" },
            { name: "Samsung Galaxy Buds 2 Pro", category: "audio", price: 95000, image: "", badge: "" },
            { name: "JBL Flip 6", category: "audio", price: 85000, image: "", badge: "" },
            { name: "Apple Watch Series 9", category: "montre", price: 350000, image: "", badge: "Nouveau" },
            { name: "Samsung Galaxy Watch 6", category: "montre", price: 250000, image: "", badge: "" },
            { name: "Coque iPhone Protection", category: "accessoire", price: 15000, image: "", badge: "" },
            { name: "Chargeur Rapide 65W", category: "accessoire", price: 25000, image: "", badge: "Promo" },
            { name: "Power Bank 20000mAh", category: "accessoire", price: 35000, image: "", badge: "" },
            { name: "Câble USB-C Tressé", category: "accessoire", price: 8000, image: "", badge: "" }
        ];
        await db.collection('products').insertMany(defaultProducts);
        console.log('📦 Produits par défaut créés');
    }
}

// ==========================================
// FONCTIONS UTILITAIRES
// ==========================================

function formatPrice(price) {
    return price.toLocaleString('fr-FR') + ' FCFA';
}

function generateSessionId() {
    return crypto.randomBytes(32).toString('hex');
}

function getCookie(req, name) {
    const cookies = req.headers.cookie || '';
    const match = cookies.match(new RegExp(`${name}=([^;]+)`));
    return match ? match[1] : null;
}

function isAuthenticated(req) {
    const sessionId = getCookie(req, 'session');
    return sessionId && sessions.has(sessionId);
}

function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            if (req.headers['content-type']?.includes('application/json')) {
                try {
                    resolve(body ? JSON.parse(body) : {});
                } catch (e) {
                    resolve({});
                }
            } else {
                const params = new URLSearchParams(body);
                const result = {};
                for (const [key, value] of params) {
                    result[key] = value;
                }
                resolve(result);
            }
        });
        req.on('error', reject);
    });
}

function parseMultipart(req) {
    return new Promise((resolve, reject) => {
        const boundary = req.headers['content-type'].split('boundary=')[1];
        let body = Buffer.alloc(0);

        req.on('data', chunk => {
            body = Buffer.concat([body, chunk]);
        });

        req.on('end', () => {
            const result = { fields: {}, file: null };
            const parts = body.toString('binary').split(`--${boundary}`);

            parts.forEach(part => {
                if (part.includes('Content-Disposition')) {
                    const nameMatch = part.match(/name="([^"]+)"/);
                    const filenameMatch = part.match(/filename="([^"]+)"/);

                    if (nameMatch) {
                        const name = nameMatch[1];
                        const contentStart = part.indexOf('\r\n\r\n') + 4;
                        let content = part.slice(contentStart);
                        content = content.replace(/\r\n$/, '');

                        if (filenameMatch && filenameMatch[1]) {
                            const filename = filenameMatch[1];
                            const ext = path.extname(filename).toLowerCase();
                            const newFilename = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}${ext}`;
                            const filepath = path.join(UPLOADS_DIR, newFilename);

                            const binaryContent = Buffer.from(content, 'binary');
                            fs.writeFileSync(filepath, binaryContent);

                            result.file = {
                                originalName: filename,
                                filename: newFilename,
                                path: `/uploads/${newFilename}`
                            };
                        } else {
                            result.fields[name] = content.trim();
                        }
                    }
                }
            });

            resolve(result);
        });

        req.on('error', reject);
    });
}

// ==========================================
// PAGES HTML
// ==========================================

function getLoginPage(error = '') {
    return `
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Faso Gadget - Connexion Admin</title>
    <link rel="stylesheet" href="/css/fonts.css">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Poppins', sans-serif;
            background: linear-gradient(135deg, #0d0d0d 0%, #1a1a1a 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .login-box {
            background: #1a1a1a;
            padding: 40px;
            border-radius: 20px;
            width: 100%;
            max-width: 400px;
            border: 1px solid #2d2d2d;
        }
        .logo { text-align: center; margin-bottom: 30px; }
        .logo img { height: 120px; filter: invert(1); margin-bottom: 10px; }
        .logo p { color: #9a9a9a; margin-top: 5px; }
        .error { background: #e63946; color: #fff; padding: 10px; border-radius: 8px; margin-bottom: 20px; text-align: center; }
        .form-group { margin-bottom: 20px; }
        .form-group label { display: block; color: #fff; margin-bottom: 8px; font-weight: 500; }
        .form-group input {
            width: 100%;
            padding: 15px;
            background: #0d0d0d;
            border: 1px solid #2d2d2d;
            border-radius: 10px;
            color: #fff;
            font-size: 1rem;
            font-family: 'Poppins', sans-serif;
        }
        .form-group input:focus { outline: none; border-color: #e63946; }
        .btn {
            width: 100%;
            padding: 15px;
            background: #e63946;
            color: #fff;
            border: none;
            border-radius: 10px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            font-family: 'Poppins', sans-serif;
        }
        .btn:hover { background: #c1121f; }
    </style>
</head>
<body>
    <div class="login-box">
        <div class="logo">
            <img src="/logo.png" alt="Faso Gadgets">
            <p>Administration</p>
        </div>
        ${error ? `<div class="error">${error}</div>` : ''}
        <form method="POST" action="/admin/login">
            <div class="form-group">
                <label>Nom d'utilisateur</label>
                <input type="text" name="username" required placeholder="admin">
            </div>
            <div class="form-group">
                <label>Mot de passe</label>
                <input type="password" name="password" required placeholder="••••••••">
            </div>
            <button type="submit" class="btn">Se connecter</button>
        </form>
    </div>
</body>
</html>`;
}

function getAdminPage(orders, products, config) {
    const categories = ['smartphone', 'audio', 'montre', 'accessoire'];

    return `
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Faso Gadget - Administration</title>
    <link rel="stylesheet" href="/css/fonts.css">
    <link rel="stylesheet" href="/css/icons.css">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Poppins', sans-serif; background: #0d0d0d; color: #fff; }
        .header {
            background: #1a1a1a;
            padding: 15px 30px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid #2d2d2d;
            position: sticky;
            top: 0;
            z-index: 100;
        }
        .header-logo { display: flex; align-items: center; gap: 15px; text-decoration: none; }
        .header-logo img { height: 65px; filter: invert(1); }
        .header-logo span { color: #fff; font-weight: 600; font-size: 0.9rem; }
        .header-actions { display: flex; gap: 15px; align-items: center; }
        .btn {
            padding: 10px 20px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-family: 'Poppins', sans-serif;
            font-weight: 500;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            text-decoration: none;
        }
        .btn-primary { background: #e63946; color: #fff; }
        .btn-primary:hover { background: #c1121f; }
        .btn-secondary { background: #2d2d2d; color: #fff; }
        .btn-secondary:hover { background: #404040; }
        .btn-danger { background: #dc3545; color: #fff; }
        .btn-sm { padding: 8px 15px; font-size: 0.85rem; }
        .container { max-width: 1400px; margin: 0 auto; padding: 30px; }
        .tabs { display: flex; gap: 10px; margin-bottom: 30px; border-bottom: 1px solid #2d2d2d; padding-bottom: 15px; }
        .tab {
            padding: 12px 25px;
            background: transparent;
            border: none;
            color: #9a9a9a;
            cursor: pointer;
            font-family: 'Poppins', sans-serif;
            font-size: 1rem;
            border-radius: 8px;
        }
        .tab.active { background: #e63946; color: #fff; }
        .tab:hover:not(.active) { background: #2d2d2d; }
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .stat {
            background: #1a1a1a;
            padding: 25px;
            border-radius: 15px;
            text-align: center;
            border: 1px solid #2d2d2d;
        }
        .stat h3 { color: #e63946; font-size: 2rem; margin-bottom: 5px; }
        .stat p { color: #9a9a9a; }
        .card {
            background: #1a1a1a;
            border-radius: 15px;
            padding: 25px;
            margin-bottom: 20px;
            border: 1px solid #2d2d2d;
        }
        .card:hover { border-color: #e63946; }
        .card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 1px solid #2d2d2d;
        }
        .order-number { color: #e63946; font-weight: 600; }
        .order-date { color: #9a9a9a; font-size: 0.9rem; }
        .client-info { background: #0d0d0d; padding: 15px; border-radius: 10px; margin-bottom: 15px; }
        .client-info h4 { color: #e63946; margin-bottom: 10px; font-size: 0.95rem; }
        .client-info p { margin: 5px 0; color: #ccc; font-size: 0.9rem; }
        .product-list { margin-top: 15px; }
        .product-row {
            display: flex;
            justify-content: space-between;
            padding: 10px 0;
            border-bottom: 1px solid #2d2d2d;
            font-size: 0.9rem;
        }
        .total-row {
            display: flex;
            justify-content: space-between;
            margin-top: 15px;
            padding-top: 15px;
            border-top: 2px solid #e63946;
            font-size: 1.1rem;
            font-weight: 600;
        }
        .total-row span:last-child { color: #e63946; }

        /* Produits */
        .products-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 20px;
        }
        .product-card {
            background: #1a1a1a;
            border-radius: 15px;
            overflow: hidden;
            border: 1px solid #2d2d2d;
        }
        .product-card:hover { border-color: #e63946; }
        .product-img {
            height: 150px;
            background: #2d2d2d;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 3rem;
            color: #6b6b6b;
            overflow: hidden;
        }
        .product-img img { width: 100%; height: 100%; object-fit: cover; }
        .product-details { padding: 20px; }
        .product-details h4 { margin-bottom: 5px; }
        .product-category { color: #e63946; font-size: 0.8rem; text-transform: uppercase; }
        .product-price { color: #e63946; font-weight: 600; margin: 10px 0; font-size: 1.1rem; }
        .product-actions { display: flex; gap: 10px; margin-top: 15px; }

        /* Modal */
        .modal {
            display: none;
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.8);
            align-items: center;
            justify-content: center;
            z-index: 1000;
            padding: 20px;
        }
        .modal.active { display: flex; }
        .modal-content {
            background: #1a1a1a;
            border-radius: 20px;
            width: 100%;
            max-width: 500px;
            max-height: 90vh;
            overflow-y: auto;
        }
        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 20px;
            border-bottom: 1px solid #2d2d2d;
        }
        .modal-header h3 { color: #e63946; }
        .close-modal {
            background: none;
            border: none;
            color: #fff;
            font-size: 1.5rem;
            cursor: pointer;
        }
        .modal-body { padding: 20px; }
        .form-group { margin-bottom: 20px; }
        .form-group label { display: block; margin-bottom: 8px; font-weight: 500; }
        .form-group input, .form-group select, .form-group textarea {
            width: 100%;
            padding: 12px;
            background: #0d0d0d;
            border: 1px solid #2d2d2d;
            border-radius: 8px;
            color: #fff;
            font-family: 'Poppins', sans-serif;
        }
        .form-group input:focus, .form-group select:focus { outline: none; border-color: #e63946; }
        .form-group input[type="file"] { padding: 10px; }
        .image-preview {
            width: 100%;
            height: 150px;
            background: #2d2d2d;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-top: 10px;
            overflow: hidden;
        }
        .image-preview img { max-width: 100%; max-height: 100%; object-fit: contain; }

        /* Settings */
        .settings-section { margin-bottom: 30px; }
        .settings-section h3 { color: #e63946; margin-bottom: 15px; }

        .no-data { text-align: center; padding: 50px; color: #9a9a9a; }
        .badge {
            display: inline-block;
            padding: 3px 10px;
            background: #e63946;
            border-radius: 15px;
            font-size: 0.75rem;
            margin-left: 10px;
        }
        .db-status {
            background: #28a745;
            color: #fff;
            padding: 5px 15px;
            border-radius: 20px;
            font-size: 0.8rem;
        }
    </style>
</head>
<body>
    <div class="header">
        <a href="/admin" class="header-logo">
            <img src="/logo.png" alt="Faso Gadgets">
            <span>Administration</span>
        </a>
        <div class="header-actions">
            <span class="db-status">MongoDB Connecté</span>
            <a href="/" class="btn btn-secondary" target="_blank"><i class="fas fa-external-link-alt"></i> Voir le site</a>
            <a href="/admin/logout" class="btn btn-danger"><i class="fas fa-sign-out-alt"></i> Déconnexion</a>
        </div>
    </div>

    <div class="container">
        <div class="tabs">
            <button class="tab active" onclick="showTab('commandes')"><i class="fas fa-shopping-cart"></i> Commandes</button>
            <button class="tab" onclick="showTab('produits')"><i class="fas fa-box"></i> Produits</button>
            <button class="tab" onclick="showTab('parametres')"><i class="fas fa-cog"></i> Paramètres</button>
        </div>

        <!-- COMMANDES -->
        <div id="commandes" class="tab-content active">
            <div class="stats">
                <div class="stat">
                    <h3>${orders.length}</h3>
                    <p>Commandes totales</p>
                </div>
                <div class="stat">
                    <h3>${formatPrice(orders.reduce((sum, o) => sum + (o.total || 0), 0))}</h3>
                    <p>Chiffre d'affaires</p>
                </div>
                <div class="stat">
                    <h3>${products.length}</h3>
                    <p>Produits</p>
                </div>
            </div>

            ${orders.length === 0 ? '<div class="no-data"><i class="fas fa-inbox" style="font-size:3rem;margin-bottom:15px;"></i><p>Aucune commande pour le moment</p></div>' : ''}

            ${orders.slice().reverse().map(order => `
                <div class="card">
                    <div class="card-header">
                        <span class="order-number">${order.numeroCommande || 'N/A'}</span>
                        <span class="order-date">${order.date ? new Date(order.date).toLocaleString('fr-FR') : 'N/A'}</span>
                    </div>
                    <div class="client-info">
                        <h4><i class="fas fa-user"></i> Client</h4>
                        <p><strong>Nom:</strong> ${order.client?.prenom || ''} ${order.client?.nom || ''}</p>
                        <p><strong>Téléphone:</strong> ${order.client?.telephone || ''}</p>
                        <p><strong>Localité:</strong> ${order.client?.localite || ''}</p>
                        ${order.client?.notes ? `<p><strong>Notes:</strong> ${order.client.notes}</p>` : ''}
                    </div>
                    <div class="product-list">
                        <h4 style="color:#e63946;margin-bottom:10px;"><i class="fas fa-box"></i> Produits</h4>
                        ${(order.produits || []).map(p => `
                            <div class="product-row">
                                <span>${p.nom} x${p.quantite}</span>
                                <span>${formatPrice(p.sousTotal || 0)}</span>
                            </div>
                        `).join('')}
                    </div>
                    <div class="total-row">
                        <span>Total</span>
                        <span>${formatPrice(order.total || 0)}</span>
                    </div>
                </div>
            `).join('')}
        </div>

        <!-- PRODUITS -->
        <div id="produits" class="tab-content">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:25px;">
                <h2>Gestion des Produits</h2>
                <button class="btn btn-primary" onclick="openModal('addProduct')">
                    <i class="fas fa-plus"></i> Ajouter un produit
                </button>
            </div>

            <div class="products-grid">
                ${products.map(p => `
                    <div class="product-card">
                        <div class="product-img">
                            ${p.image ? `<img src="${p.image}" alt="${p.name}">` : '<i class="fas fa-image"></i>'}
                        </div>
                        <div class="product-details">
                            <span class="product-category">${p.category}</span>
                            <h4>${p.name} ${p.badge ? `<span class="badge">${p.badge}</span>` : ''}</h4>
                            <div class="product-price">${formatPrice(p.price)}</div>
                            <div class="product-actions">
                                <button class="btn btn-secondary btn-sm" onclick="editProduct('${p._id}')">
                                    <i class="fas fa-edit"></i> Modifier
                                </button>
                                <button class="btn btn-danger btn-sm" onclick="deleteProduct('${p._id}')">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>

        <!-- PARAMETRES -->
        <div id="parametres" class="tab-content">
            <div class="card">
                <h3 style="color:#e63946;margin-bottom:20px;"><i class="fas fa-key"></i> Modifier les identifiants</h3>
                <form method="POST" action="/admin/settings">
                    <div class="form-group">
                        <label>Nouveau nom d'utilisateur</label>
                        <input type="text" name="username" value="${config.username || 'admin'}" required>
                    </div>
                    <div class="form-group">
                        <label>Nouveau mot de passe</label>
                        <input type="password" name="password" placeholder="Laisser vide pour ne pas changer">
                    </div>
                    <button type="submit" class="btn btn-primary">
                        <i class="fas fa-save"></i> Enregistrer
                    </button>
                </form>
            </div>
        </div>
    </div>

    <!-- Modal Ajout/Edit Produit -->
    <div class="modal" id="productModal">
        <div class="modal-content">
            <div class="modal-header">
                <h3 id="modalTitle">Ajouter un produit</h3>
                <button class="close-modal" onclick="closeModal()">&times;</button>
            </div>
            <div class="modal-body">
                <form id="productForm" method="POST" enctype="multipart/form-data">
                    <input type="hidden" name="id" id="productId">
                    <div class="form-group">
                        <label>Nom du produit *</label>
                        <input type="text" name="name" id="productName" required placeholder="Ex: iPhone 15 Pro">
                    </div>
                    <div class="form-group">
                        <label>Catégorie *</label>
                        <select name="category" id="productCategory" required>
                            <option value="">Sélectionner...</option>
                            ${categories.map(c => `<option value="${c}">${c.charAt(0).toUpperCase() + c.slice(1)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Prix (FCFA) *</label>
                        <input type="number" name="price" id="productPrice" required placeholder="Ex: 850000">
                    </div>
                    <div class="form-group">
                        <label>Badge (optionnel)</label>
                        <input type="text" name="badge" id="productBadge" placeholder="Ex: Nouveau, Promo, Best-seller">
                    </div>
                    <div class="form-group">
                        <label>Image</label>
                        <input type="file" name="image" id="productImage" accept="image/*" onchange="previewImage(this)">
                        <div class="image-preview" id="imagePreview">
                            <span style="color:#6b6b6b;">Aperçu de l'image</span>
                        </div>
                    </div>
                    <button type="submit" class="btn btn-primary" style="width:100%;">
                        <i class="fas fa-save"></i> Enregistrer
                    </button>
                </form>
            </div>
        </div>
    </div>

    <script>
        const products = ${JSON.stringify(products.map(p => ({...p, _id: p._id.toString()})))};

        function showTab(tabId) {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            document.getElementById(tabId).classList.add('active');
            event.target.classList.add('active');
        }

        function openModal(type) {
            document.getElementById('productModal').classList.add('active');
            document.getElementById('modalTitle').textContent = 'Ajouter un produit';
            document.getElementById('productForm').action = '/admin/products/add';
            document.getElementById('productForm').reset();
            document.getElementById('productId').value = '';
            document.getElementById('imagePreview').innerHTML = '<span style="color:#6b6b6b;">Aperçu de l\\'image</span>';
        }

        function closeModal() {
            document.getElementById('productModal').classList.remove('active');
        }

        function editProduct(id) {
            const product = products.find(p => p._id === id);
            if (!product) return;

            document.getElementById('productModal').classList.add('active');
            document.getElementById('modalTitle').textContent = 'Modifier le produit';
            document.getElementById('productForm').action = '/admin/products/edit';
            document.getElementById('productId').value = product._id;
            document.getElementById('productName').value = product.name;
            document.getElementById('productCategory').value = product.category;
            document.getElementById('productPrice').value = product.price;
            document.getElementById('productBadge').value = product.badge || '';

            if (product.image) {
                document.getElementById('imagePreview').innerHTML = '<img src="' + product.image + '">';
            }
        }

        function deleteProduct(id) {
            if (confirm('Supprimer ce produit ?')) {
                fetch('/admin/products/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id })
                }).then(() => location.reload());
            }
        }

        function previewImage(input) {
            const preview = document.getElementById('imagePreview');
            if (input.files && input.files[0]) {
                const reader = new FileReader();
                reader.onload = e => {
                    preview.innerHTML = '<img src="' + e.target.result + '">';
                };
                reader.readAsDataURL(input.files[0]);
            }
        }

        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') closeModal();
        });
    </script>
</body>
</html>`;
}

// ==========================================
// SERVEUR
// ==========================================

const server = http.createServer(async (req, res) => {
    // Attendre la connexion DB
    if (!db) {
        res.writeHead(503, { 'Content-Type': 'text/html' });
        res.end('<h1>Service en cours de démarrage...</h1><p>Rechargez la page dans quelques secondes.</p>');
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // Headers CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // ============ API PUBLIQUE ============

    // API: Liste des produits
    if (req.method === 'GET' && pathname === '/api/produits') {
        try {
            const products = await db.collection('products').find({}).toArray();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(products.map(p => ({
                id: p._id.toString(),
                name: p.name,
                category: p.category,
                price: p.price,
                image: p.image,
                badge: p.badge
            }))));
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Erreur serveur' }));
        }
        return;
    }

    // API: Nouvelle commande
    if (req.method === 'POST' && pathname === '/api/commandes') {
        try {
            const orderData = await parseBody(req);
            await db.collection('orders').insertOne(orderData);

            console.log('\n' + '='.repeat(50));
            console.log('🛒 NOUVELLE COMMANDE!');
            console.log(`📋 ${orderData.numeroCommande}`);
            console.log(`👤 ${orderData.client?.prenom} ${orderData.client?.nom}`);
            console.log(`📞 ${orderData.client?.telephone}`);
            console.log(`📍 ${orderData.client?.localite}`);
            console.log(`💰 ${formatPrice(orderData.total || 0)}`);
            console.log('='.repeat(50) + '\n');

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Erreur serveur' }));
        }
        return;
    }

    // ============ AUTHENTIFICATION ============

    if (pathname === '/admin/login') {
        if (req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(getLoginPage());
            return;
        }

        if (req.method === 'POST') {
            const body = await parseBody(req);
            const config = await db.collection('config').findOne({ _id: 'admin' });

            if (body.username === config.username && body.password === config.password) {
                const sessionId = generateSessionId();
                sessions.set(sessionId, { username: body.username, createdAt: Date.now() });

                res.writeHead(302, {
                    'Location': '/admin',
                    'Set-Cookie': `session=${sessionId}; Path=/; HttpOnly`
                });
                res.end();
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(getLoginPage('Identifiants incorrects'));
            }
            return;
        }
    }

    // Déconnexion
    if (pathname === '/admin/logout') {
        const sessionId = getCookie(req, 'session');
        if (sessionId) sessions.delete(sessionId);
        res.writeHead(302, {
            'Location': '/admin/login',
            'Set-Cookie': 'session=; Path=/; Max-Age=0'
        });
        res.end();
        return;
    }

    // ============ ADMIN (protégé) ============

    if (pathname.startsWith('/admin')) {
        if (!isAuthenticated(req)) {
            res.writeHead(302, { 'Location': '/admin/login' });
            res.end();
            return;
        }

        // Dashboard admin
        if (pathname === '/admin' && req.method === 'GET') {
            const orders = await db.collection('orders').find({}).toArray();
            const products = await db.collection('products').find({}).toArray();
            const config = await db.collection('config').findOne({ _id: 'admin' });
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(getAdminPage(orders, products, config));
            return;
        }

        // Modifier les paramètres
        if (pathname === '/admin/settings' && req.method === 'POST') {
            const body = await parseBody(req);
            const updateData = { username: body.username };
            if (body.password) {
                updateData.password = body.password;
            }
            await db.collection('config').updateOne(
                { _id: 'admin' },
                { $set: updateData }
            );
            res.writeHead(302, { 'Location': '/admin' });
            res.end();
            return;
        }

        // Ajouter un produit
        if (pathname === '/admin/products/add' && req.method === 'POST') {
            const { fields, file } = await parseMultipart(req);
            const newProduct = {
                name: fields.name,
                category: fields.category,
                price: parseInt(fields.price) || 0,
                badge: fields.badge || '',
                image: file ? file.path : ''
            };
            await db.collection('products').insertOne(newProduct);
            res.writeHead(302, { 'Location': '/admin' });
            res.end();
            return;
        }

        // Modifier un produit
        if (pathname === '/admin/products/edit' && req.method === 'POST') {
            const { ObjectId } = require('mongodb');
            const { fields, file } = await parseMultipart(req);
            const updateData = {
                name: fields.name,
                category: fields.category,
                price: parseInt(fields.price) || 0,
                badge: fields.badge || ''
            };
            if (file) {
                updateData.image = file.path;
            }
            await db.collection('products').updateOne(
                { _id: new ObjectId(fields.id) },
                { $set: updateData }
            );
            res.writeHead(302, { 'Location': '/admin' });
            res.end();
            return;
        }

        // Supprimer un produit
        if (pathname === '/admin/products/delete' && req.method === 'POST') {
            const { ObjectId } = require('mongodb');
            const body = await parseBody(req);
            await db.collection('products').deleteOne({ _id: new ObjectId(body.id) });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
        }
    }

    // ============ FICHIERS STATIQUES ============

    let filePath = pathname === '/' ? '/index.html' : pathname;
    filePath = path.join(__dirname, filePath);

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 - Page non trouvée');
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

// Démarrer le serveur après connexion DB
async function startServer() {
    console.log('\n' + '='.repeat(50));
    console.log('🚀 FASO GADGET - Démarrage...');
    console.log('='.repeat(50));

    const connected = await connectDB();

    if (!connected) {
        console.log('⚠️  Mode dégradé: MongoDB non disponible');
    }

    server.listen(PORT, () => {
        console.log(`📍 Site: http://localhost:${PORT}`);
        console.log(`🔐 Admin: http://localhost:${PORT}/admin`);
        console.log('='.repeat(50) + '\n');
    });
}

startServer();
