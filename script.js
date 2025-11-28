/* ==========================================
   FASO GADGET - JavaScript
   ========================================== */

// ==========================================
// DONNÉES DES PRODUITS (chargés depuis l'API)
// ==========================================

let products = [];

// ==========================================
// PANIER
// ==========================================

let cart = JSON.parse(localStorage.getItem('fasoGadgetCart')) || [];

// ==========================================
// FONCTIONS UTILITAIRES
// ==========================================

function formatPrice(price) {
    return price.toLocaleString('fr-FR') + ' FCFA';
}

function saveCart() {
    localStorage.setItem('fasoGadgetCart', JSON.stringify(cart));
}

// ==========================================
// CHARGEMENT DES PRODUITS DEPUIS L'API
// ==========================================

async function loadProducts() {
    try {
        const response = await fetch('/api/produits');
        if (response.ok) {
            products = await response.json();
        }
    } catch (error) {
        console.error('Erreur chargement produits:', error);
    }
    return products;
}

// ==========================================
// AFFICHAGE DES PRODUITS
// ==========================================

function renderProducts(filter = 'all') {
    const grid = document.getElementById('productsGrid');
    let filteredProducts = products;

    if (filter !== 'all') {
        filteredProducts = products.filter(p => p.category === filter);
    }

    if (filteredProducts.length === 0) {
        grid.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 50px; color: #9a9a9a;">
                <i class="fas fa-box-open" style="font-size: 3rem; margin-bottom: 15px;"></i>
                <p>Aucun produit dans cette catégorie</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = filteredProducts.map(product => `
        <div class="product-card" data-category="${product.category}">
            <div class="product-image">
                ${product.image ? `<img src="${product.image}" alt="${product.name}">` : getDefaultEmoji(product.category)}
                ${product.badge ? `<span class="product-badge">${product.badge}</span>` : ''}
            </div>
            <div class="product-info">
                <div class="product-category">${getCategoryName(product.category)}</div>
                <h3 class="product-name">${product.name}</h3>
                <div class="product-price">${formatPrice(product.price)}</div>
                <div class="product-actions">
                    <button class="add-to-cart" onclick="addToCart(${product.id})">
                        <i class="fas fa-cart-plus"></i> Ajouter
                    </button>
                </div>
            </div>
        </div>
    `).join('');
}

function getDefaultEmoji(category) {
    const emojis = {
        'smartphone': '<span style="font-size:4rem;">📱</span>',
        'audio': '<span style="font-size:4rem;">🎧</span>',
        'montre': '<span style="font-size:4rem;">⌚</span>',
        'accessoire': '<span style="font-size:4rem;">🔌</span>'
    };
    return emojis[category] || '<span style="font-size:4rem;">📦</span>';
}

function getCategoryName(category) {
    const names = {
        'smartphone': 'Smartphone',
        'audio': 'Audio',
        'montre': 'Montre Connectée',
        'accessoire': 'Accessoire'
    };
    return names[category] || category;
}

function filterProducts(category) {
    // Mettre à jour les boutons actifs
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');

    // Filtrer les produits
    renderProducts(category);
}

// ==========================================
// GESTION DU PANIER
// ==========================================

function addToCart(productId) {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    const existingItem = cart.find(item => item.id === productId);

    if (existingItem) {
        existingItem.quantity++;
    } else {
        cart.push({
            id: product.id,
            name: product.name,
            price: product.price,
            image: product.image || getDefaultEmoji(product.category),
            quantity: 1
        });
    }

    saveCart();
    updateCartUI();
    showNotification(`${product.name} ajouté au panier!`);
}

function removeFromCart(productId) {
    cart = cart.filter(item => item.id !== productId);
    saveCart();
    updateCartUI();
}

function updateQuantity(productId, change) {
    const item = cart.find(item => item.id === productId);
    if (!item) return;

    item.quantity += change;

    if (item.quantity <= 0) {
        removeFromCart(productId);
    } else {
        saveCart();
        updateCartUI();
    }
}

function updateCartUI() {
    const cartCount = document.getElementById('cartCount');
    const cartItems = document.getElementById('cartItems');
    const cartTotal = document.getElementById('cartTotal');

    // Mettre à jour le compteur
    const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
    cartCount.textContent = totalItems;

    // Mettre à jour les items du panier
    if (cart.length === 0) {
        cartItems.innerHTML = `
            <div class="cart-empty">
                <i class="fas fa-shopping-cart"></i>
                <p>Votre panier est vide</p>
            </div>
        `;
    } else {
        cartItems.innerHTML = cart.map(item => `
            <div class="cart-item">
                <div class="cart-item-image">
                    ${item.image && item.image.startsWith('/') ? `<img src="${item.image}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">` : (item.image || '📦')}
                </div>
                <div class="cart-item-details">
                    <div class="cart-item-name">${item.name}</div>
                    <div class="cart-item-price">${formatPrice(item.price)}</div>
                    <div class="cart-item-quantity">
                        <button class="qty-btn" onclick="updateQuantity(${item.id}, -1)">-</button>
                        <span>${item.quantity}</span>
                        <button class="qty-btn" onclick="updateQuantity(${item.id}, 1)">+</button>
                    </div>
                </div>
                <button class="cart-item-remove" onclick="removeFromCart(${item.id})">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `).join('');
    }

    // Mettre à jour le total
    const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    cartTotal.textContent = formatPrice(total);
}

function toggleCart() {
    const sidebar = document.getElementById('cartSidebar');
    const overlay = document.getElementById('cartOverlay');
    sidebar.classList.toggle('active');
    overlay.classList.toggle('active');
}

// ==========================================
// MODAL DE COMMANDE
// ==========================================

function openOrderModal() {
    if (cart.length === 0) {
        showNotification('Votre panier est vide!', 'error');
        return;
    }

    toggleCart();
    const modal = document.getElementById('orderModal');
    modal.classList.add('active');
    updateOrderSummary();
}

function closeOrderModal() {
    const modal = document.getElementById('orderModal');
    modal.classList.remove('active');
}

function updateOrderSummary() {
    const summaryItems = document.getElementById('orderSummaryItems');
    const orderTotal = document.getElementById('orderTotal');

    summaryItems.innerHTML = cart.map(item => `
        <div class="order-summary-item">
            <span>${item.name} x${item.quantity}</span>
            <span>${formatPrice(item.price * item.quantity)}</span>
        </div>
    `).join('');

    const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    orderTotal.textContent = formatPrice(total);
}

// ==========================================
// SOUMISSION DE COMMANDE
// ==========================================

async function submitOrder(event) {
    event.preventDefault();

    const form = event.target;
    const formData = new FormData(form);

    const orderData = {
        client: {
            nom: formData.get('nom'),
            prenom: formData.get('prenom'),
            telephone: formData.get('telephone'),
            localite: formData.get('localite'),
            notes: formData.get('notes')
        },
        produits: cart.map(item => ({
            nom: item.name,
            prix: item.price,
            quantite: item.quantity,
            sousTotal: item.price * item.quantity
        })),
        total: cart.reduce((sum, item) => sum + (item.price * item.quantity), 0),
        date: new Date().toISOString(),
        numeroCommande: 'FG-' + Date.now()
    };

    try {
        const response = await fetch('/api/commandes', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(orderData)
        });

        if (response.ok) {
            showConfirmation();
        } else {
            saveOrderLocally(orderData);
            showConfirmation();
        }
    } catch (error) {
        saveOrderLocally(orderData);
        showConfirmation();
    }
}

function saveOrderLocally(orderData) {
    const orders = JSON.parse(localStorage.getItem('fasoGadgetOrders')) || [];
    orders.push(orderData);
    localStorage.setItem('fasoGadgetOrders', JSON.stringify(orders));
    console.log('Commande sauvegardée localement:', orderData);
}

function showConfirmation() {
    closeOrderModal();

    // Vider le panier
    cart = [];
    saveCart();
    updateCartUI();

    // Réinitialiser le formulaire
    document.getElementById('orderForm').reset();

    // Afficher modal de confirmation
    const confirmModal = document.getElementById('confirmModal');
    confirmModal.classList.add('active');
}

function closeConfirmModal() {
    const confirmModal = document.getElementById('confirmModal');
    confirmModal.classList.remove('active');
}

// ==========================================
// MENU MOBILE
// ==========================================

function toggleMobileMenu() {
    const menu = document.getElementById('mobileMenu');
    menu.classList.toggle('active');
}

// ==========================================
// NOTIFICATIONS
// ==========================================

function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: ${type === 'success' ? '#4caf50' : '#e63946'};
        color: white;
        padding: 15px 25px;
        border-radius: 10px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        z-index: 3000;
        animation: slideIn 0.3s ease;
        font-family: 'Poppins', sans-serif;
    `;
    notification.textContent = message;

    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
    `;
    document.head.appendChild(style);

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 3000);
}

// ==========================================
// INITIALISATION
// ==========================================

document.addEventListener('DOMContentLoaded', async () => {
    // Charger les produits depuis l'API
    await loadProducts();
    renderProducts();
    updateCartUI();

    // Fermer les modals avec Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeOrderModal();
            closeConfirmModal();
            if (document.getElementById('cartSidebar').classList.contains('active')) {
                toggleCart();
            }
        }
    });

    // Smooth scroll pour les liens d'ancrage
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });
});
