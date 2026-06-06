document.addEventListener('DOMContentLoaded', () => {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        window.location.href = 'login.html';
    }

    const ordersContainer = document.getElementById('orders-container');
    const logoutButton = document.getElementById('logout');

    const fetchOrders = async () => {
        try {
            const response = await fetch('http://localhost:3000/api/v1/admin/orders', {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });
            if (!response.ok) {
                throw new Error('Failed to fetch orders');
            }
            const data = await response.json();
            renderOrders(data.orders);
        } catch (error) {
            console.error(error);
        }
    };

    const renderOrders = (orders) => {
        ordersContainer.innerHTML = '';
        orders.forEach(order => {
            const orderCard = document.createElement('div');
            orderCard.classList.add('order-card');

            const items = order.items.map(item => `<p>${item.name} x ${item.quantity}</p>`).join('');

            orderCard.innerHTML = `
                <h3>Order #${order.orderNumber}</h3>
                <p>Customer: ${order.customer.name}</p>
                <p>Transaction ID: ${order.payment.transactionId}</p>
                <div>
                    <h4>Items:</h4>
                    ${items}
                </div>
                <p>Total: ${order.financials.customerPays}</p>
                <p>Status: ${order.status}</p>
                <select class="status-select" data-id="${order.id}">
                    <option value="payment_verification_pending" ${order.status === 'payment_verification_pending' ? 'selected' : ''}>Payment Verification Pending</option>
                    <option value="placed" ${order.status === 'placed' ? 'selected' : ''}>Placed</option>
                    <option value="accepted" ${order.status === 'accepted' ? 'selected' : ''}>Accepted</option>
                    <option value="preparing" ${order.status === 'preparing' ? 'selected' : ''}>Preparing</option>
                    <option value="ready" ${order.status === 'ready' ? 'selected' : ''}>Ready</option>
                    <option value="out_for_delivery" ${order.status === 'out_for_delivery' ? 'selected' : ''}>Out for Delivery</option>
                    <option value="delivered" ${order.status === 'delivered' ? 'selected' : ''}>Delivered</option>
                    <option value="cancelled" ${order.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
                </select>
            `;
            ordersContainer.appendChild(orderCard);
        });
    };

    ordersContainer.addEventListener('change', async (e) => {
        if (e.target.classList.contains('status-select')) {
            const orderId = e.target.dataset.id;
            const newStatus = e.target.value;

            try {
                const response = await fetch(`http://localhost:3000/api/v1/admin/orders/${orderId}/status`, {
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

                fetchOrders();
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

    fetchOrders();
});