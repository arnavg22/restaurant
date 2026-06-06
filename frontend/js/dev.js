document.addEventListener('DOMContentLoaded', () => {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        window.location.href = 'login.html';
    }

    const statsContainer = document.getElementById('stats-container');
    const logoutButton = document.getElementById('logout');

    const fetchStats = async () => {
        try {
            const response = await fetch('http://localhost:3000/api/v1/dev/stats', {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });
            if (!response.ok) {
                throw new Error('Failed to fetch stats');
            }
            const stats = await response.json();
            renderStats(stats);
        } catch (error) {
            console.error(error);
        }
    };

    const renderStats = (stats) => {
        statsContainer.innerHTML = '';
        for (const key in stats) {
            const statCard = document.createElement('div');
            statCard.classList.add('stat-card');
            statCard.innerHTML = `
                <h3>${key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}</h3>
                <p>${stats[key]}</p>
            `;
            statsContainer.appendChild(statCard);
        }
    };

    logoutButton.addEventListener('click', () => {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('user');
        window.location.href = 'login.html';
    });

    fetchStats();
});