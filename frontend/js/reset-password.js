document.getElementById('reset-password-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirm-password').value;
    const message = document.getElementById('message');

    if (password !== confirmPassword) {
        message.textContent = 'Passwords do not match';
        return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');

    if (!token) {
        message.textContent = 'Invalid or missing reset token.';
        return;
    }

    try {
        const response = await fetch('http://localhost:3000/api/v1/auth/reset-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ token, password })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || 'Failed to reset password');
        }

        message.textContent = 'Password has been reset successfully. You can now login with your new password.';
    } catch (error) {
        message.textContent = error.message;
    }
});