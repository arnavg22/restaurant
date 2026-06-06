document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const errorMessage = document.getElementById('error-message');

    try {
        const response = await fetch('http://localhost:3000/api/v1/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || 'Login failed');
        }

        localStorage.setItem('accessToken', data.accessToken);
        localStorage.setItem('refreshToken', data.refreshToken);
        localStorage.setItem('user', JSON.stringify(data.user));

        switch (data.user.role) {
            case 'admin':
                window.location.href = 'admin.html';
                break;
            case 'customer':
                window.location.href = 'customer.html';
                break;
            case 'delivery':
                window.location.href = 'delivery.html';
                break;
            case 'developer':
                window.location.href = 'dev.html';
                break;
            default:
                throw new Error('Unknown user role');
        }
    } catch (error) {
        errorMessage.textContent = error.message;
    }
});