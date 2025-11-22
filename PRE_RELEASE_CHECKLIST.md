# Pre-Release Checklist for burrs.io

## 🔴 CRITICAL - Must Fix Before Release

### Security & Anti-Cheat
- [ ] **Remove debug commands** - Remove 'Z' key debug score hack (client & server)
- [ ] **Remove debugSetScore socket event** from serveru8
- [ ] **Add rate limiting** for socket events (prevent spam/DDoS)
- [ ] **Add input validation** for all socket events
- [ ] **Add player position validation** (prevent teleport hacks)
- [ ] **Add score validation** (prevent score manipulation)
- [ ] **Implement proper authentication** (currently anyone can join)
- [ ] **Add CAPTCHA or bot protection** on join
- [ ] **Sanitize all user inputs** (username, chat messages)
- [ ] **Add profanity filter** for usernames and chat
- [ ] **Implement IP-based rate limiting**
- [ ] **Add server-side movement validation** (speed hacks)

### Performance & Scalability
- [ ] **Add spatial partitioning** for collision detection (quadtree/grid)
- [ ] **Optimize network updates** (only send visible players to each client)
- [ ] **Add player limit per server** (currently unlimited)
- [ ] **Implement server clustering** for multiple game rooms
- [ ] **Add connection pooling** for database (if using one)
- [ ] **Optimize canvas rendering** (object pooling, reduce draw calls)
- [ ] **Add FPS limiter** on client side
- [ ] **Implement delta compression** for network updates
- [ ] **Add memory leak detection** and cleanup

### Critical Bugs
- [ ] **Test ability cooldown reset** thoroughly
- [ ] **Test evolution state persistence** across reconnects
- [ ] **Fix potential race conditions** in collision detection
- [ ] **Test death animation edge cases** (multiple simultaneous deaths)
- [ ] **Verify server doesn't crash** when all players disconnect
- [ ] **Test with 100+ concurrent players** (stress test)
- [ ] **Fix potential memory leaks** in particle systems
- [ ] **Test mobile performance** on low-end devices
- [ ] **Verify joystick works** on all mobile browsers

### Data & State Management
- [ ] **Add database** for persistent data (MongoDB/PostgreSQL)
- [ ] **Implement player accounts** (optional but recommended)
- [ ] **Add persistent leaderboard** (all-time, daily, weekly)
- [ ] **Save player stats** (kills, deaths, playtime, highest score)
- [ ] **Implement session management**
- [ ] **Add reconnection handling** (rejoin same game after disconnect)
- [ ] **Save evolution progress** on disconnect

## 🟡 HIGH PRIORITY - Should Fix Before Release

### Game Balance
- [x] **Balance all spike types** (test win rates)
- [x] **Balance ability cooldowns** (test in real gameplay)
- [x] **Balance AI difficulty** (not too easy/hard)
- [x] **Balance food spawn rates**
- [x] **Balance premium orb spawn rates**
- [x] **Test team balance** (ensure fair spawns)
- [x] **Balance collision damage** formulas

### User Experience
- [x] **Add tutorial/onboarding** for new players (How to Play modal)
- [x] **Add controls guide** (show WASD, N, Space, Enter) - Press H in-game
- [x] **Add ability tooltips** in evolution screen (already present)
- [x] **Add loading screen** with tips
- [x] **Add "How to Play" section** in menu
- [x] **Add settings menu** (sound, graphics quality) - Audio settings available
- [x] **Add keybinding customization**
- [x] **Improve mobile UI** (larger buttons, better layout)
- [x] **Add haptic feedback** for mobile

### Sound & Audio
- [x] **Add background music** (toggleable)
- [x] **Add sound effects** for:
  - [x] Eating food
  - [x] Collisions
  - [x] Ability usage
  - [x] Evolution
  - [x] Death
  - [x] Speed boost
  - [x] UI clicks
  - [x] Chat messages
  - [x] Premium orbs
  - [x] Spawn/Respawn
  - [x] Kill enemy
- [x] **Add volume controls** (master, music, SFX)
- [x] **Add audio settings** in menu
- [x] **YouTube music integration**
- [x] **Custom music URL support**
- [x] **Audio settings persistence** (localStorage)

### Visual Polish
- [x] **Add particle effects** for:
  - [x] Food collection (already has some)
  - [x] Premium orb collection (already has some)
  - [x] Player spawn
  - [x] Ability activation
- [x] **Improve death animation** (more dramatic)
- [x] **Add screen shake** for collisions
- [x] **Add camera zoom** based on player size
- [x] **Improve minimap** (show more info)
- [x] **Add visual feedback** for damage taken
- [x] **Add team indicators** (more visible)

### Content
- [x] **Add Tier 2 evolutions** (at 15,000 score) - 18 variants implemented
  - [x] Prickle Vanguard, Swarm, Bastion
  - [x] Thorn Wraith, Reaper, Shade
  - [x] Bristle Blitz, Strider, Skirmisher
  - [x] Bulwark Aegis, Citadel, Juggernaut
  - [x] Starflare Pulsar, Horizon, Nova
  - [x] Mauler Ravager, Bulwark, Apex
- [x] **Tier 2 visual distinctiveness** - All Tier 2 spikes have unique spike patterns
- [x] **Tier 2 ability mechanics** - All abilities fully functional:
  - [x] Spine Storm (PrickleSwarm) - Rapid damage ticks in radius
  - [x] Execution Lunge (ThornReaper) - Damage boost + slow enemies
  - [x] Trailing Surge (BristleStrider) - Damaging trail behind player
  - [x] Unstoppable (BulwarkJuggernaut) - Invincibility + no knockback
  - [x] Nova Shift (StarflareNova) - Teleport + delayed explosion
  - [x] Offensive Warp (StarflarePulsar) - Teleport + shockwave
- [x] **Tier 2 ability VFX** - Unique visual effects for all Tier 2 abilities
- [ ] **Add achievements system**
- [ ] **Add cosmetics shop** (use premium orbs as currency)
- [ ] **Add player skins/colors**
- [ ] **Add name tags customization**

## 🟢 MEDIUM PRIORITY - Nice to Have

### Features
- [ ] **Add game modes** (FFA, Team Deathmatch, Battle Royale)
- [ ] **Add private lobbies**
- [ ] **Add party system** (play with friends)
- [ ] **Add spectator mode** (watch after death)
- [ ] **Add replay system**
- [x] **Add friend system**
- [ ] **Add clan/guild system**
- [ ] **Add seasonal events**
- [x] **Add power-ups** (shield, speed, damage boost)
- [ ] **Add environmental hazards**

### Social Features
- [x] **Add player profiles**
- [ ] **Add global chat** (separate from game chat)
- [ ] **Add emotes/reactions**
- [ ] **Add player reporting system**
- [ ] **Add mute/block players**
- [x] **Add friend requests**
- [ ] **Add team voice chat** (optional)
- [ ] **Add ranking/ELO system**
- [ ] **Add seasonal leaderboards**

### Analytics & Monitoring
- [ ] **Add analytics tracking** (Google Analytics, Mixpanel)
- [ ] **Add error logging** (Sentry, LogRocket)
- [ ] **Add performance monitoring**
- [ ] **Add server health monitoring**
- [ ] **Add player behavior tracking**
- [ ] **Add A/B testing framework**


### SEO & Marketing
- [ ] **Add meta tags** (title, description, keywords)
- [ ] **Add Open Graph tags** for social sharing
- [ ] **Add Twitter Card tags**
- [ ] **Add favicon** and app icons
- [ ] **Add sitemap.xml**
- [ ] **Add robots.txt**
- [ ] **Optimize page load time**
- [ ] **Add Google Search Console**
- [ ] **Create landing page** with game info
- [ ] **Add screenshots/gameplay video**

## 🔵 LOW PRIORITY - Future Enhancements

### Mobile Optimization
- [ ] **Test on iOS Safari**
- [ ] **Test on Android Chrome**
- [ ] **Test on various screen sizes**
- [ ] **Add PWA support** (installable app)
- [ ] **Add offline mode** (practice mode)
- [ ] **Optimize touch controls**
- [ ] **Add gesture controls**

### Monetization (Optional)
- [ ] **Add premium currency** (real money)
- [ ] **Add cosmetics shop** (paid items)
- [ ] **Add battle pass system**
- [ ] **Add ads** (non-intrusive)
- [ ] **Add donation/support option**
- [ ] **Add premium membership**

## 📋 TESTING CHECKLIST

### Functional Testing
- [ ] **Test all spike types** and abilities
- [ ] **Test evolution system** (all paths)
  - [ ] Test Tier 1 evolution at 5,000 score
  - [ ] Test Tier 2 evolution at 15,000 score
  - [ ] Test all 6 Tier 1 spike types
  - [ ] Test all 18 Tier 2 spike variants
  - [ ] Test size preservation on evolution (should maintain proportional size)
  - [ ] Test ability replacement (Tier 2 replaces Tier 1 ability)
  - [ ] Test multi-tier jump (0 to 30k should prompt tier 1 then tier 2)
- [ ] **Test Tier 2 abilities**
  - [ ] PrickleVanguard: Overdensity (2.2x damage + 30% reduction)
  - [ ] PrickleSwarm: Spine Storm (rapid damage ticks)
  - [ ] PrickleBastion: Spine Bulwark (50% reduction + 25% reflect)
  - [ ] ThornWraith: Wraith Walk (3.5s ghost mode)
  - [ ] ThornReaper: Execution Lunge (+40% damage + slow)
  - [ ] ThornShade: Shadow Slip (instant dash)
  - [ ] BristleBlitz: Triple Rush (2.3x speed)
  - [ ] BristleStrider: Trailing Surge (2x speed + trail)
  - [ ] BristleSkirmisher: Kinetic Guard (1.8x speed + 20% reduction)
  - [ ] BulwarkAegis: Fortified Aegis (3.5s invincibility)
  - [ ] BulwarkCitadel: Bastion Field (aura + knockback)
  - [ ] BulwarkJuggernaut: Unstoppable (invincible + no knockback)
  - [ ] StarflarePulsar: Offensive Warp (teleport + shockwave)
  - [ ] StarflareHorizon: Short Blink (short-range teleport)
  - [ ] StarflareNova: Nova Shift (teleport + delayed explosion)
  - [ ] MaulerRavager: Rend (bleed damage)
  - [ ] MaulerBulwark: Fortified Fortress (35% reduction + thorns)
  - [ ] MaulerApex: Blood Frenzy (+25% damage, +15% speed, +15% damage taken)
- [ ] **Test death and respawn**
- [ ] **Test chat system**
- [ ] **Test minimap**
- [ ] **Test leaderboard**
- [ ] **Test team bases**
- [ ] **Test AI hunters**
- [ ] **Test food collection**
- [ ] **Test premium orbs**
- [ ] **Test speed boost**
- [ ] **Test collision detection**
- [ ] **Test movement** (WASD, joystick)
- [ ] **Test mobile controls**

### Cross-Browser Testing
- [ ] **Chrome** (desktop & mobile)
- [ ] **Firefox** (desktop & mobile)
- [ ] **Safari** (desktop & mobile)
- [ ] **Edge**
- [ ] **Opera**
- [ ] **Samsung Internet**

### Performance Testing
- [ ] **Test with 10 players**
- [ ] **Test with 50 players**
- [ ] **Test with 100+ players**
- [ ] **Test on low-end devices**
- [ ] **Test on slow internet** (3G, 4G)
- [ ] **Test with high latency** (200ms+)
- [ ] **Monitor memory usage**
- [ ] **Monitor CPU usage**
- [ ] **Monitor network bandwidth**

### Security Testing
- [ ] **Test XSS vulnerabilities**
- [ ] **Test SQL injection** (if using database)
- [ ] **Test CSRF attacks**
- [ ] **Test rate limiting**
- [ ] **Test input validation**
- [ ] **Test authentication bypass**
- [ ] **Penetration testing**

## 🚀 DEPLOYMENT CHECKLIST

### Pre-Deployment
- [ ] **Set up production server** (AWS, DigitalOcean, Heroku, Render)
- [ ] **Set up CDN** for static assets
- [ ] **Set up SSL certificate** (HTTPS)
- [ ] **Set up domain name**
- [ ] **Configure environment variables**
- [ ] **Set up database** (if using)
- [ ] **Set up backup system**
- [ ] **Set up monitoring** (uptime, errors)
- [ ] **Set up logging**
- [ ] **Configure CORS** properly
- [ ] **Minify and bundle** client code
- [ ] **Optimize images** and assets
- [ ] **Enable gzip compression**
- [ ] **Set up load balancer** (for multiple servers)

### Deployment
- [ ] **Deploy server** to production
- [ ] **Deploy client** to production
- [ ] **Test production environment**
- [ ] **Set up CI/CD pipeline** (GitHub Actions, etc.)
- [ ] **Create deployment scripts**
- [ ] **Document deployment process**

### Post-Deployment
- [ ] **Monitor server health**
- [ ] **Monitor error rates**
- [ ] **Monitor player count**
- [ ] **Set up alerts** for downtime
- [ ] **Create rollback plan**
- [ ] **Set up staging environment**
- [ ] **Create hotfix process**

## 📝 LEGAL & COMPLIANCE

### Legal
- [ ] **Add Terms of Service**
- [ ] **Add Privacy Policy**
- [ ] **Add Cookie Policy** (if using cookies)
- [ ] **Add GDPR compliance** (if EU users)
- [ ] **Add COPPA compliance** (if under-13 users)
- [ ] **Add DMCA policy**
- [ ] **Add content moderation policy**
- [ ] **Add refund policy** (if monetized)

### Compliance
- [ ] **Add age verification** (if needed)
- [ ] **Add data retention policy**
- [ ] **Add data deletion** (user request)
- [ ] **Add export user data** (GDPR)
- [ ] **Add consent management**

## 🎨 BRANDING & ASSETS

### Visual Assets
- [ ] **Create logo** (multiple sizes)
- [ ] **Create favicon** (16x16, 32x32, etc.)
- [ ] **Create app icons** (iOS, Android)
- [ ] **Create social media banners**
- [ ] **Create promotional images**
- [ ] **Create gameplay screenshots**
- [ ] **Create gameplay video/trailer**

### Branding
- [ ] **Define color palette**
- [ ] **Define typography**
- [ ] **Create brand guidelines**
- [ ] **Create style guide**

## 📊 METRICS TO TRACK

### Player Metrics
- [ ] **Daily Active Users (DAU)**
- [ ] **Monthly Active Users (MAU)**
- [ ] **Average session length**
- [ ] **Player retention** (1-day, 7-day, 30-day)
- [ ] **Churn rate**
- [ ] **New player conversion**

### Game Metrics
- [ ] **Average game duration**
- [ ] **Most popular spike types**
- [ ] **Most used abilities**
- [ ] **Kill/death ratios**
- [ ] **Score distribution**
- [ ] **Evolution rates**

### Technical Metrics
- [ ] **Server uptime**
- [ ] **Average latency**
- [ ] **Error rates**
- [ ] **Crash rates**
- [ ] **Page load time**
- [ ] **FPS (client-side)**

## 🔧 CODE QUALITY

### Code Review
- [ ] **Remove all console.log** statements
- [ ] **Remove all debug code**
- [ ] **Add error handling** everywhere
- [ ] **Add try-catch blocks** for critical code
- [ ] **Validate all inputs**
- [ ] **Add TypeScript types** for everything
- [ ] **Fix all TypeScript errors**
- [ ] **Fix all ESLint warnings**
- [ ] **Add code comments** for complex logic
- [ ] **Remove unused code**
- [ ] **Remove unused dependencies**

### Testing
- [ ] **Add unit tests** (Jest, Vitest)
- [ ] **Add integration tests**
- [ ] **Add E2E tests** (Playwright, Cypress)
- [ ] **Achieve 80%+ code coverage**
- [ ] **Add performance tests**
- [ ] **Add load tests**

## 📱 ACCESSIBILITY

### WCAG Compliance
- [ ] **Add keyboard navigation**
- [ ] **Add screen reader support**
- [ ] **Add ARIA labels**
- [ ] **Add alt text** for images
- [ ] **Ensure color contrast** (WCAG AA)
- [ ] **Add focus indicators**
- [ ] **Support browser zoom**
- [ ] **Add captions** for audio (if any)

## 🌍 INTERNATIONALIZATION

### i18n Support
- [ ] **Add language selection**
- [ ] **Translate UI** to multiple languages
- [ ] **Support RTL languages** (Arabic, Hebrew)
- [ ] **Localize numbers/dates**
- [ ] **Add region-specific servers**

---

## ✅ MINIMUM VIABLE PRODUCT (MVP) - Must Have

**If you want to release quickly, focus on these critical items:**

1. ✅ Remove debug commands (Z key)
2. ✅ Add rate limiting
3. ✅ Add profanity filter
4. ✅ Add player limit per server
5. ✅ Add sound effects (basic)
6. ✅ Add tutorial/controls guide
7. ✅ Update README.md
8. ✅ Add Terms of Service & Privacy Policy
9. ✅ Set up production server
10. ✅ Test with 50+ players
11. ✅ Add error logging
12. ✅ Add SSL/HTTPS
13. ✅ Add meta tags for SEO
14. ✅ Cross-browser testing

**Everything else can be added post-launch as updates!**
