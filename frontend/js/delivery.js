document.addEventListener('DOMContentLoaded', () => {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        window.location.href = 'login.html';
    }

    const readyOrdersContainer = document.getElementById('ready-orders-container');
    const logoutButton = document.getElementById('logout');

    const fetchReadyOrders = async () => {
        try {
            const response = await fetch('http://localhost:3000/api/v1/delivery/orders', {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });
            if (!response.ok) {
                throw new Error('Failed to fetch ready orders');
            }
            const orders = await response.json();
            renderReadyOrders(orders);
        } catch (error) {
            console.error(error);
        }
    };

    const renderReadyOrders = (orders) => {
        readyOrdersContainer.innerHTML = '';
        orders.forEach(order => {
            const orderCard = document.createElement('div');
            orderCard.classList.add('order-card');
            orderCard.innerHTML = `
                <h3>Order #${order.orderNumber}</h3>
                <p>Customer: ${order.deliveryName}</p>
                <p>Address: ${order.buildingName}, ${order.floorSeat}</p>
                <p>Status: ${order.status}</p>
                <button class="update-status-btn" data-id="${order.id}" data-status="out_for_delivery">Mark as Out for Delivery</button>
                <button class="update-status-btn" data-id="${order.id}" data-status="delivered">Mark as Delivered</button>
            `;
            readyOrdersContainer.appendChild(orderCard);
        });
    };

    readyOrdersContainer.addEventListener('click', async (e) => {
        if (e.target.classList.contains('update-status-btn')) {
            const orderId = e.target.dataset.id;
            const newStatus = e.target.dataset.status;

            try {
                const response = await fetch(`http://localhost:3000/api/v1/delivery/orders/${orderId}/status`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${accessToken}`
                    },
                    body: JSON.stringify({ status: newStatus })
                });

                if (!response.ok) {
                    throw new Error('Failed to update order status');
                }

                fetchReadyOrders();
            } catch (error) {
                console.error(error);
                alert('Failed to update order status');
            }
        }
    });

    logoutButton.addEventListener('click', () => {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('user');
        window.location.href = 'login.html';
    });

    fetchReadyOrders();
});