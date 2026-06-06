document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('name').value;
    const email = document.getElementById('email').value;
    const phone = document.getElementById('phone').value;
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirm-password').value;
    const errorMessage = document.getElementById('error-message');

    if (password !== confirmPassword) {
        errorMessage.textContent = 'Passwords do not match';
        return;
    }

    try {
        const response = await fetch('http://localhost:3000/api/v1/auth/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name, email, phone, password })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || 'Registration failed');
        }

        alert('Registration successful! Please login.');
        window.location.href = 'login.html';
    } catch (error) {
        errorMessage.textContent = error.message;
    }
});