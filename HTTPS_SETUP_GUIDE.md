# HTTPS Setup Guide for Burrs.io Game Servers

## Problem
Your client is hosted on HTTPS (`https://burrs.io`) but trying to connect to HTTP game servers, causing **Mixed Content** errors that block the connection.

## Solution
Set up HTTPS/SSL on your Google Cloud game servers using **nginx as a reverse proxy** with **Let's Encrypt SSL certificates**.

---

## Prerequisites
- Domain names pointing to your servers:
  - `burrs.io` → US Server (34.42.22.179)
  - `eu.burrs.io` → EU Server (130.211.106.44)
- SSH access to both Google Cloud servers
- Port 80 and 443 open in firewall rules

---

## Step 1: Install nginx and Certbot

SSH into each server and run:

```bash
# Update package list
sudo apt update

# Install nginx
sudo apt install -y nginx

# Install Certbot for Let's Encrypt SSL
sudo apt install -y certbot python3-certbot-nginx
```

---

## Step 2: Configure nginx as Reverse Proxy

Create nginx configuration for your game server:

```bash
sudo nano /etc/nginx/sites-available/burrs-io
```

Add this configuration (adjust domain for each server):

```nginx
# For US Server (burrs.io)
server {
    listen 80;
    server_name burrs.io;

    location / {
        proxy_pass http://localhost:5174;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # WebSocket support
        proxy_read_timeout 86400;
    }
}
```

For EU server, use `eu.burrs.io` instead of `burrs.io`.

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/burrs-io /etc/nginx/sites-enabled/
sudo nginx -t  # Test configuration
sudo systemctl restart nginx
```

---

## Step 3: Obtain SSL Certificates

Run Certbot to get free SSL certificates from Let's Encrypt:

```bash
# For US Server
sudo certbot --nginx -d burrs.io

# For EU Server
sudo certbot --nginx -d eu.burrs.io
```

Follow the prompts:
1. Enter your email
2. Agree to terms
3. Choose to redirect HTTP to HTTPS (recommended)

Certbot will automatically:
- Obtain SSL certificates
- Update nginx configuration
- Set up auto-renewal

---

## Step 4: Update Firewall Rules

Ensure ports 80 and 443 are open in Google Cloud:

```bash
# Allow HTTP (for Let's Encrypt verification)
gcloud compute firewall-rules create allow-http --allow tcp:80

# Allow HTTPS
gcloud compute firewall-rules create allow-https --allow tcp:443
```

---

## Step 5: Verify HTTPS is Working

Test your servers:

```bash
# US Server
curl https://burrs.io/health

# EU Server
curl https://eu.burrs.io/health
```

You should see: `{"status":"ok","message":"Server is running"}`

---

## Step 6: Update Game Server CORS (Already Done)

The CORS configuration in `server/gameServer.js` has already been updated to allow HTTPS domains.

---

## Step 7: Test the Game

1. Visit `https://burrs.io`
2. Open browser DevTools (F12) → Console
3. Verify no "Mixed Content" errors
4. Connect to a server and play!

---

## Auto-Renewal

Let's Encrypt certificates expire every 90 days. Certbot sets up auto-renewal automatically.

Test renewal:
```bash
sudo certbot renew --dry-run
```

---

## Troubleshooting

### Mixed Content Error Still Appears
- Clear browser cache
- Check nginx is running: `sudo systemctl status nginx`
- Check SSL certificate: `sudo certbot certificates`

### WebSocket Connection Fails
- Verify nginx WebSocket config is correct
- Check nginx error logs: `sudo tail -f /var/log/nginx/error.log`

### Certificate Renewal Fails
- Ensure port 80 is open (Let's Encrypt uses HTTP-01 challenge)
- Check Certbot logs: `sudo journalctl -u certbot`

---

## Summary

After completing these steps:
- ✅ Game servers accessible via HTTPS
- ✅ No more Mixed Content errors
- ✅ Secure WebSocket connections (wss://)
- ✅ Auto-renewing SSL certificates
- ✅ Production-ready setup

Your game will now work perfectly on `https://burrs.io`! 🎉

