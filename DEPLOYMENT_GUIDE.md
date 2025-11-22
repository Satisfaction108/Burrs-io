# Burrs.io Deployment Guide

## Current Setup

### Servers
- **US Server:** http://34.42.22.179:5174 (Google Cloud - us-central1)
- **EU Server:** http://130.211.106.44:5174 (Google Cloud - europe-west1)
- **Max Players per Server:** 50

### Server Status
Both servers are running with PM2 process manager and are configured to auto-restart on failure.

---

## Deploying Client to Render.com (burrs-io.render.com)

### Step 1: Prepare the Build

1. **Update environment variables for production:**

Create/update `.env.production`:
```env
# This will be ignored since we're using the server selector
# But keep it as fallback
VITE_SERVER_URL=http://34.42.22.179:5174
```

2. **Build the client:**
```bash
npm run build
```

This creates a `dist/` folder with your production-ready static files.

### Step 2: Deploy to Render.com

#### Option A: Deploy via GitHub (Recommended)

1. **Push your code to GitHub:**
```bash
git add .
git commit -m "Add server selector and prepare for deployment"
git push origin main
```

2. **Create a new Static Site on Render:**
   - Go to: https://dashboard.render.com
   - Click "New +" → "Static Site"
   - Connect your GitHub repository
   - Configure:
     - **Name:** `burrs-io`
     - **Branch:** `main`
     - **Build Command:** `npm install && npm run build`
     - **Publish Directory:** `dist`
   - Click "Create Static Site"

3. **Wait for deployment** (~2-5 minutes)

4. **Your site will be live at:** `https://burrs-io.onrender.com`

#### Option B: Deploy via Render CLI

```bash
# Install Render CLI
npm install -g render-cli

# Login to Render
render login

# Deploy
render deploy
```

### Step 3: Configure CORS on Servers

Update both servers' CORS settings to allow the new domain:

**On both US and EU servers, edit `server/gameServer.js`:**

Find the CORS configuration (around line 18-26) and add your Render domain:

```javascript
app.use(cors({
  origin: [
    "https://burrs-io.onrender.com",  // ← Add this
    "http://34.42.22.179:5174",
    "http://130.211.106.44:5174",
    "http://localhost:5173",
    "http://localhost:5174"
  ],
  credentials: true
}));
```

Also update the Socket.IO CORS (around line 493-503):

```javascript
const io = new Server(httpServer, {
  cors: {
    origin: [
      "https://burrs-io.onrender.com",  // ← Add this
      "http://localhost:5173",
      "http://localhost:5174"
    ],
    methods: ["GET", "POST"],
    credentials: true
  }
});
```

**Restart both servers:**
```bash
pm2 restart burrs-io-us
pm2 restart burrs-io-eu
```

### Step 4: Test the Deployment

1. Visit: https://burrs-io.onrender.com
2. Click "Select Server" button
3. Choose US or EU server
4. Verify player count shows correctly
5. Click "Connect to Server"
6. Play the game!

---

## Switching to Custom Domain (burrs.io)

### Step 1: Purchase Domain

1. Buy `burrs.io` from a domain registrar (Namecheap, GoDaddy, Google Domains, etc.)

### Step 2: Configure DNS

Add these DNS records at your domain registrar:

**For Render.com hosting:**

| Type  | Name | Value                          | TTL  |
|-------|------|--------------------------------|------|
| CNAME | @    | burrs-io.onrender.com          | 3600 |
| CNAME | www  | burrs-io.onrender.com          | 3600 |

### Step 3: Add Custom Domain in Render

1. Go to your Render dashboard
2. Click on your `burrs-io` static site
3. Go to "Settings" tab
4. Scroll to "Custom Domains"
5. Click "Add Custom Domain"
6. Enter: `burrs.io`
7. Click "Add Custom Domain" again and enter: `www.burrs.io`
8. Wait for SSL certificate to be provisioned (~5-10 minutes)

### Step 4: Update CORS Configuration

**On both US and EU servers, update CORS to include your custom domain:**

Edit `server/gameServer.js`:

```javascript
app.use(cors({
  origin: [
    "https://burrs.io",              // ← Add this
    "https://www.burrs.io",          // ← Add this
    "https://burrs-io.onrender.com",
    "http://34.42.22.179:5174",
    "http://130.211.106.44:5174",
    "http://localhost:5173",
    "http://localhost:5174"
  ],
  credentials: true
}));
```

And Socket.IO CORS:

```javascript
const io = new Server(httpServer, {
  cors: {
    origin: [
      "https://burrs.io",              // ← Add this
      "https://www.burrs.io",          // ← Add this
      "https://burrs-io.onrender.com",
      "http://localhost:5173",
      "http://localhost:5174"
    ],
    methods: ["GET", "POST"],
    credentials: true
  }
});
```

**Restart both servers:**
```bash
pm2 restart burrs-io-us
pm2 restart burrs-io-eu
```

### Step 5: Test Custom Domain

1. Visit: https://burrs.io
2. Verify SSL certificate is working (🔒 in browser)
3. Test server selector
4. Play the game!

---

## Server Maintenance

### Viewing Logs

**US Server:**
```bash
pm2 logs burrs-io-us
pm2 logs burrs-io-us --lines 100
```

**EU Server:**
```bash
pm2 logs burrs-io-eu
pm2 logs burrs-io-eu --lines 100
```

### Restarting Servers

```bash
# Restart specific server
pm2 restart burrs-io-us
pm2 restart burrs-io-eu

# Restart all
pm2 restart all

# Reload (zero-downtime)
pm2 reload burrs-io-us
```

### Checking Server Status

```bash
pm2 status
pm2 monit  # Real-time monitoring
```

### Updating Game Code

**On each server:**

```bash
cd ~/Burrs-io
git pull origin main
cd server
npm install  # If dependencies changed
pm2 restart burrs-io-us  # or burrs-io-eu
```

---

## Troubleshooting

### Players Can't Connect

1. **Check firewall rules:**
   - Google Cloud Console → VPC Network → Firewall
   - Verify port 5174 is open for both servers

2. **Check server status:**
   ```bash
   pm2 status
   ss -tlnp | grep 5174
   ```

3. **Check MongoDB connection:**
   - Verify IPs are whitelisted in MongoDB Atlas
   - Check logs: `pm2 logs burrs-io-us --lines 50`

### Server Selector Shows "Offline"

1. **Check server is running:**
   ```bash
   curl http://localhost:5174/api/game/status
   ```

2. **Check CORS configuration** - make sure client domain is allowed

3. **Check firewall** - port 5174 must be open

### High Latency

1. **Check server resources:**
   ```bash
   pm2 monit
   htop
   ```

2. **Consider upgrading machine type** if CPU/RAM is maxed out

3. **Check network** - run `ping` tests from client locations

---

## Cost Breakdown

### Current Setup (Monthly)

- **US Server (c4a-highcpu-2):** ~$35/month
- **EU Server (c4a-highcpu-2):** ~$35/month
- **MongoDB Atlas (Free Tier):** $0/month
- **Render.com Static Hosting:** $0/month (free tier)
- **Domain (burrs.io):** ~$12/year (~$1/month)

**Total:** ~$71/month

### With $300 Google Cloud Credit

You have **~4.2 months** of free hosting before the credit runs out.

---

## Next Steps

1. ✅ Deploy client to Render.com
2. ✅ Test both servers with server selector
3. ⏳ Purchase burrs.io domain
4. ⏳ Configure custom domain
5. ⏳ Set up monitoring/analytics
6. ⏳ Add more features!

---

## Support

If you encounter issues:

1. Check server logs: `pm2 logs`
2. Check browser console for errors
3. Verify CORS configuration
4. Test server status endpoint: `/api/game/status`

Good luck with your deployment! 🚀


