document.addEventListener('DOMContentLoaded', () => {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        window.location.href = 'login.html';
    }

    const menuItemsContainer = document.getElementById('menu-items');
    const cartItemsContainer = document.getElementById('cart-items');
    const cartTotalElement = document.getElementById('cart-total');
    const orderForm = document.getElementById('order-form');
    const logoutButton = document.getElementById('logout');

    let menuItems = [];
    let cart = [];

    const fetchMenu = async () => {
        try {
            const response = await fetch('http://localhost:3000/api/v1/menu', {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });
            if (!response.ok) {
                throw new Error('Failed to fetch menu');
            }
            menuItems = await response.json();
            renderMenu();
        } catch (error) {
            console.error(error);
        }
    };

    const renderMenu = () => {
        menuItemsContainer.innerHTML = '';
        menuItems.forEach(item => {
            const menuItemElement = document.createElement('div');
            menuItemElement.classList.add('menu-item');
            menuItemElement.innerHTML = `
                <h3>${item.name}</h3>
                <p>${item.description}</p>
                <p>Price: ${item.price}</p>
                <button data-id="${item.id}">Add to Cart</button>
            `;
            menuItemsContainer.appendChild(menuItemElement);
        });
    };

    const renderCart = () => {
        cartItemsContainer.innerHTML = '';
        let total = 0;
        cart.forEach(item => {
            const cartItemElement = document.createElement('div');
            cartItemElement.classList.add('cart-item');
            cartItemElement.innerHTML = `
                <p>${item.name} x ${item.quantity}</p>
                <p>Total: ${item.price * item.quantity}</p>
            `;
            cartItemsContainer.appendChild(cartItemElement);
            total += item.price * item.quantity;
        });
        cartTotalElement.textContent = total.toFixed(2);
    };

    menuItemsContainer.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') {
            const menuItemId = e.target.dataset.id;
            const menuItem = menuItems.find(item => item.id === menuItemId);
            if (menuItem) {
                const cartItem = cart.find(item => item.id === menuItemId);
                if (cartItem) {
                    cartItem.quantity++;
                } else {
                    cart.push({ ...menuItem, quantity: 1 });
                }
                renderCart();
            }
        }
    });

    orderForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const deliveryDetails = {
            deliveryName: document.getElementById('delivery-name').value,
            deliveryPhone: document.getElementById('delivery-phone').value,
            buildingName: document.getElementById('building-name').value,
            floorSeat: document.getElementById('floor-seat').value,
            deliveryNotes: document.getElementById('delivery-notes').value
        };

        const transactionId = document.getElementById('transaction-id').value;

        const orderData = {
            items: cart.map(item => ({ menuItemId: item.id, quantity: item.quantity })),
            delivery: deliveryDetails,
            transactionId: transactionId
        };

        try {
            const response = await fetch('http://localhost:3000/api/v1/orders', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${accessToken}`
                },
                body: JSON.stringify(orderData)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to place order');
            }

            alert('Order placed successfully!');
            cart = [];
            renderCart();
            orderForm.reset();
        } catch (error) {
            console.error(error);
            alert(error.message);
        }
    });

    logoutButton.addEventListener('click', () => {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('user');
        window.location.href = 'login.html';
    });

    fetchMenu();
});