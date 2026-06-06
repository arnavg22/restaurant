document.getElementById('forgot-password-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = document.getElementById('email').value;
    const message = document.getElementById('message');

    try {
        const response = await fetch('http://localhost:3000/api/v1/auth/forgot-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || 'Failed to send password reset link');
        }

        message.textContent = 'Password reset link has been logged to the backend console.';
    } catch (error) {
        message.textContent = error.message;
    }
});