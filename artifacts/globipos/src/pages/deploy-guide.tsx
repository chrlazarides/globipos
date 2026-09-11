import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import {
  Copy, Check, Server, Database, Globe, Package, Mail,
  Shield, AlertTriangle, CheckCircle2, ChevronRight,
  Terminal, ArrowLeft, Info, RefreshCw, HelpCircle,
} from "lucide-react";

function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      toast({ title: "Copied to clipboard" });
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="relative group my-2">
      {label && <p className="text-xs text-muted-foreground mb-1">{label}</p>}
      <pre className="bg-zinc-950 dark:bg-zinc-900 text-green-400 text-xs rounded-lg p-3 pr-10 overflow-x-auto font-mono leading-relaxed whitespace-pre-wrap break-all">
        {code}
      </pre>
      <button
        onClick={copy}
        className="absolute top-2 right-2 p-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200 opacity-0 group-hover:opacity-100 transition-opacity"
        title="Copy"
      >
        {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
      </button>
    </div>
  );
}

function Step({ n, title, icon: Icon, children }: { n: number; title: string; icon: any; children: React.ReactNode }) {
  return (
    <Card className="border-l-4 border-l-primary">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-3 text-base">
          <span className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-bold shrink-0">
            {n}
          </span>
          <Icon className="w-5 h-5 text-muted-foreground" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm space-y-2 pt-0">{children}</CardContent>
    </Card>
  );
}

function Note({ type = "info", children }: { type?: "info" | "warning" | "success"; children: React.ReactNode }) {
  const styles = {
    info: "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-200",
    warning: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200",
    success: "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800 text-green-900 dark:text-green-200",
  };
  const icons = { info: Info, warning: AlertTriangle, success: CheckCircle2 };
  const Icon = icons[type];
  return (
    <div className={`flex gap-2 rounded-lg border p-3 text-xs ${styles[type]}`}>
      <Icon className="w-4 h-4 shrink-0 mt-0.5" />
      <div>{children}</div>
    </div>
  );
}

export default function DeployGuide() {
  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/settings">
          <button className="flex items-center gap-1 hover:text-foreground transition-colors">
            <ArrowLeft className="w-3 h-3" />
            Back to Settings
          </button>
        </Link>
        <ChevronRight className="w-3 h-3" />
        <span>Self-Hosting Guide</span>
      </div>

      <PageHeader
        title="Self-Hosting Deployment Guide"
        description="Step-by-step instructions to run this system on your own server or hosting account"
      />

      {/* Overview */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="pt-4 text-sm space-y-2">
          <p className="font-semibold">What this guide covers</p>
          <p className="text-muted-foreground">
            By the end of this guide your system will be running on your own server, accessible at your
            own domain name, with HTTPS (padlock), automatic daily backups, and email. You do not need
            to be a programmer — just follow each step in order and copy-paste the commands shown.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {["~60–90 minutes total", "Linux server or cPanel hosting", "A domain name", "PostgreSQL database"].map(tag => (
              <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* What you need */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <HelpCircle className="w-4 h-4 text-muted-foreground" />
            Before you start — what you need
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 font-semibold">Item</th>
                <th className="text-left py-2 font-semibold">Why you need it</th>
                <th className="text-left py-2 font-semibold">Where to get it</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr>
                <td className="py-2 font-medium">A Linux server or cPanel hosting account</td>
                <td className="py-2 text-muted-foreground">This is where the app will live 24/7</td>
                <td className="py-2 text-muted-foreground">Hetzner, DigitalOcean, Contabo, or any cPanel host (e.g. Hostinger, SiteGround)</td>
              </tr>
              <tr>
                <td className="py-2 font-medium">A domain name</td>
                <td className="py-2 text-muted-foreground">e.g. erp.globi-pos.com — the address users will type</td>
                <td className="py-2 text-muted-foreground">Namecheap, GoDaddy, Cloudflare</td>
              </tr>
              <tr>
                <td className="py-2 font-medium">SSH access to the server</td>
                <td className="py-2 text-muted-foreground">To type commands remotely. Like a remote control for the server</td>
                <td className="py-2 text-muted-foreground">Your host provides credentials. Use PuTTY (Windows) or Terminal (Mac/Linux)</td>
              </tr>
              <tr>
                <td className="py-2 font-medium">The deployment package ZIP</td>
                <td className="py-2 text-muted-foreground">Contains your database, config files and setup script</td>
                <td className="py-2 text-muted-foreground">Settings → Backup & Recovery → <strong>cPanel Deployment Package</strong></td>
              </tr>
            </tbody>
          </table>
          <Note type="info">
            <strong>Recommended hosting:</strong> A Hetzner CX22 VPS (€4/month, Ubuntu 22.04) is ideal.
            For cPanel users, any host that supports Node.js 20 and PostgreSQL will work.
          </Note>
        </CardContent>
      </Card>

      {/* Steps */}
      <div className="space-y-4">

        {/* Step 1 */}
        <Step n={1} title="Download the Deployment Package" icon={Package}>
          <p className="text-muted-foreground">This is the ZIP file that contains everything needed to set up the server.</p>
          <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
            <li>Go to <strong>Settings → Backup &amp; Recovery</strong></li>
            <li>Scroll down to <strong>Full System Export</strong></li>
            <li>Click <strong>cPanel Deployment Package</strong></li>
            <li>A ZIP file will download to your computer — keep it safe</li>
          </ol>
          <Note type="info">
            The ZIP contains: your full database dump, a setup script, a config template, a PM2 process
            config, and this deployment guide. It does <strong>not</strong> contain the app source code
            (you get that separately via Git in Step 3).
          </Note>
        </Step>

        {/* Step 2 */}
        <Step n={2} title="Point Your Domain to the Server" icon={Globe}>
          <p className="text-muted-foreground">
            Before anything else, point your domain to your server's IP address. This can take up to
            24 hours to work worldwide (usually much faster).
          </p>
          <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
            <li>Log in to wherever you bought your domain (Namecheap, GoDaddy, Cloudflare, etc.)</li>
            <li>Find <strong>DNS Settings</strong> or <strong>Manage DNS</strong></li>
            <li>Add or edit an <strong>A record</strong>:
              <ul className="list-disc list-inside ml-4 mt-1 space-y-0.5">
                <li>Name / Host: <code className="bg-muted px-1 rounded">@</code> (or your subdomain, e.g. <code className="bg-muted px-1 rounded">erp</code>)</li>
                <li>Value / Points to: your server's IP address (e.g. <code className="bg-muted px-1 rounded">65.21.42.100</code>)</li>
                <li>TTL: 3600 (or Auto)</li>
              </ul>
            </li>
            <li>Save and wait — you can continue with the other steps while DNS propagates</li>
          </ol>
          <Note type="warning">
            You must do this step <strong>first</strong> so the TLS/HTTPS certificate can be issued in
            Step 9. If DNS isn't pointing to your server when you run Caddy/Certbot, the certificate
            will fail.
          </Note>
        </Step>

        {/* Step 3 */}
        <Step n={3} title="Upload the App Code to Your Server" icon={Terminal}>
          <p className="text-muted-foreground">
            Connect to your server and download the application code. The commands below are typed into
            your SSH terminal (or cPanel Terminal).
          </p>
          <CodeBlock label="Connect to your server via SSH (replace with your server's IP):" code={`ssh root@65.21.42.100`} />
          <CodeBlock label="Install Git if not already installed:" code={`sudo apt update && sudo apt install -y git`} />
          <CodeBlock label="Download the application code:" code={`git clone https://github.com/YOUR_REPO/vintrade.git /var/www/globi-pos
cd /var/www/globi-pos`} />
          <Note type="info">
            <strong>No Git repo?</strong> Use SFTP (FileZilla) or cPanel File Manager to upload the
            project folder to <code>/home/cpuser/globi-pos/</code>. Then also upload the contents
            of the ZIP file into the same folder.
          </Note>
          <p className="text-muted-foreground">Once the code is uploaded, extract the ZIP contents into the same folder:</p>
          <CodeBlock label="Upload the ZIP to the server, then extract it:" code={`cd /var/www/globi-pos
unzip ~/fc-globi-pos-ltd-cpanel-*.zip -d ./deploy-files
cp deploy-files/database.sql .
cp deploy-files/.env.example .
cp deploy-files/ecosystem.config.js .
cp deploy-files/setup.sh .
chmod +x setup.sh`} />
        </Step>

        {/* Step 4 */}
        <Step n={4} title="Install Node.js 20" icon={Terminal}>
          <p className="text-muted-foreground">
            Node.js is the engine that runs the application. We need version 20 (the current Long Term
            Support version).
          </p>
          <CodeBlock label="Install nvm (Node Version Manager) — a tool to manage Node.js versions:" code={`curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc`} />
          <CodeBlock label="Install and activate Node.js 20:" code={`nvm install 20
nvm use 20
nvm alias default 20`} />
          <CodeBlock label="Confirm it worked (should print v20.x.x):" code={`node -v`} />
          <Note type="info">
            <strong>On cPanel:</strong> Go to <strong>Setup Node.js App</strong> and choose version 20.x
            — no terminal commands needed.
          </Note>
        </Step>

        {/* Step 5 */}
        <Step n={5} title="Create a PostgreSQL Database" icon={Database}>
          <p className="text-muted-foreground">
            PostgreSQL is the database that stores all your data (invoices, customers, accounts, etc.).
          </p>
          <div className="space-y-3">
            <div>
              <p className="font-medium text-xs mb-1">Option A — On a VPS (Ubuntu/Debian):</p>
              <CodeBlock code={`# Install PostgreSQL
sudo apt install -y postgresql postgresql-client

# Open the PostgreSQL command line
sudo -u postgres psql`} />
              <CodeBlock label="Inside the PostgreSQL prompt, run these commands (change the password!):" code={`CREATE DATABASE globi-pos;
CREATE USER gastro_user WITH ENCRYPTED PASSWORD 'ChangeThisPassword123!';
GRANT ALL PRIVILEGES ON DATABASE globi-pos TO gastro_user;
\\q`} />
              <p className="text-muted-foreground text-xs mt-1">
                Your connection string will be:{" "}
                <code className="bg-muted px-1 rounded">postgresql://gastro_user:ChangeThisPassword123!@localhost:5432/globi-pos</code>
              </p>
            </div>
            <div>
              <p className="font-medium text-xs mb-1">Option B — On cPanel:</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground text-xs">
                <li>Log into cPanel → click <strong>PostgreSQL Databases</strong></li>
                <li>Under "Create New Database" type a name (e.g. <code>globi-pos</code>) → click <strong>Create Database</strong></li>
                <li>Under "Add New User" create a user with a strong password</li>
                <li>Under "Add User to Database" connect the user to the database — select <strong>All Privileges</strong></li>
                <li>Your connection string: <code>postgresql://cpuser_YOURUSER:PASSWORD@localhost:5432/cpuser_globi-pos</code></li>
              </ol>
            </div>
          </div>
        </Step>

        {/* Step 6 */}
        <Step n={6} title="Import the Database" icon={Database}>
          <p className="text-muted-foreground">
            This loads all your existing data (customers, invoices, items, accounts, users) into the
            new database. It also creates the full schema automatically.
          </p>
          <CodeBlock label="Replace the connection string with yours from Step 5:" code={`psql "postgresql://gastro_user:ChangeThisPassword123!@localhost:5432/globi-pos" < database.sql`} />
          <p className="text-muted-foreground">
            This will run for a few seconds and then finish silently if successful. If you see errors
            about roles or ownership, they are harmless — the data still imports correctly.
          </p>
          <Note type="success">
            <strong>All your passwords carry over.</strong> User accounts and their bcrypt-hashed
            passwords are included in the dump, so everyone can log in with the same password they used before.
          </Note>
        </Step>

        {/* Step 7 */}
        <Step n={7} title="Create Your Configuration File (.env)" icon={Shield}>
          <p className="text-muted-foreground">
            The <code>.env</code> file is a private settings file that tells the app how to connect to
            the database and how to secure sessions. It must <strong>never</strong> be shared or
            committed to Git.
          </p>
          <CodeBlock label="Copy the template:" code={`cp .env.example .env
nano .env`} />
          <p className="text-muted-foreground">Fill in these two required values:</p>
          <CodeBlock label="Your .env file should look like this (replace all placeholder values):" code={`DATABASE_URL=postgresql://gastro_user:ChangeThisPassword123!@localhost:5432/globi-pos

# Generate a random secret with the command below, then paste it here:
SESSION_SECRET=paste_your_64_character_hex_string_here

NODE_ENV=production
PORT=3000`} />
          <CodeBlock label="Generate your SESSION_SECRET (run this, copy the output, paste into .env):" code={`node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`} />
          <Note type="warning">
            <strong>SESSION_SECRET is critical for security.</strong> It must be a long random string —
            never use the word "secret" or any guessable value. Run the command above and paste the
            output.
          </Note>
          <CodeBlock label="Save and exit nano:" code={`# Press Ctrl+O then Enter to save, then Ctrl+X to exit`} />
        </Step>

        {/* Step 8 */}
        <Step n={8} title="Install Dependencies and Build the App" icon={Terminal}>
          <p className="text-muted-foreground">
            This step downloads all the required libraries and compiles the application into an
            optimised production build.
          </p>
          <CodeBlock label="Install production dependencies (may take 1–3 minutes):" code={`npm install --omit=dev`} />
          <CodeBlock label="Build the app (compiles TypeScript and bundles the frontend):" code={`npm run build`} />
          <CodeBlock label="Apply any pending database schema updates:" code={`npm run db:push`} />
          <Note type="info">
            If <code>npm run build</code> fails with a TypeScript error, make sure you're in the right
            folder (the one with <code>package.json</code> in it).
          </Note>
        </Step>

        {/* Step 9 */}
        <Step n={9} title="Start the App with PM2 (Process Manager)" icon={Server}>
          <p className="text-muted-foreground">
            PM2 is a process manager that keeps the app running 24/7, restarts it if it crashes, and
            starts it automatically when the server reboots.
          </p>
          <CodeBlock label="Install PM2 globally:" code={`npm install -g pm2`} />
          <CodeBlock label="Start the app using the included config file:" code={`pm2 start ecosystem.config.js`} />
          <CodeBlock label="Save the process list so PM2 restores it after a reboot:" code={`pm2 save`} />
          <CodeBlock label="Set PM2 to start on system boot (run the command it prints):" code={`pm2 startup`} />
          <CodeBlock label="Check the app is running (should show 'online' in green):" code={`pm2 status`} />
          <CodeBlock label="See live logs to confirm everything started correctly:" code={`pm2 logs fc-globi-pos-ltd --lines 20`} />
          <Note type="success">
            The app is now running on <strong>port 3000</strong>. Next step makes it available on your
            domain with HTTPS.
          </Note>
        </Step>

        {/* Step 10 */}
        <Step n={10} title="Set Up HTTPS on Your Domain" icon={Globe}>
          <p className="text-muted-foreground">
            A reverse proxy sits in front of the app and handles your domain name and the HTTPS
            padlock. Choose one of the two options below.
          </p>
          <div className="space-y-4">
            <div>
              <Badge className="mb-2">Recommended — Caddy (handles HTTPS automatically)</Badge>
              <CodeBlock label="Install Caddy:" code={`sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/deb/debian/dists/any-version/Release' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy`} />
              <CodeBlock label="Edit the Caddyfile (replace yourdomain.com with your real domain):" code={`sudo nano /etc/caddy/Caddyfile`} />
              <CodeBlock label="Paste this content (replace yourdomain.com):" code={`yourdomain.com {
    reverse_proxy localhost:3000
}`} />
              <CodeBlock label="Reload Caddy to apply:" code={`sudo systemctl reload caddy`} />
              <Note type="success">
                Caddy automatically gets and renews an HTTPS certificate from Let's Encrypt for free.
                Your site will be live at <strong>https://yourdomain.com</strong> within seconds.
              </Note>
            </div>
            <div>
              <Badge variant="secondary" className="mb-2">Alternative — Nginx + Certbot</Badge>
              <CodeBlock label="Install Nginx and Certbot:" code={`sudo apt install -y nginx certbot python3-certbot-nginx`} />
              <CodeBlock label="Create a site config:" code={`sudo nano /etc/nginx/sites-available/globi-pos`} />
              <CodeBlock label="Paste this (replace yourdomain.com):" code={`server {
    listen 80;
    server_name yourdomain.com;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}`} />
              <CodeBlock code={`sudo ln -s /etc/nginx/sites-available/globi-pos /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d yourdomain.com`} />
            </div>
            <div>
              <Badge variant="outline" className="mb-2">cPanel users</Badge>
              <p className="text-muted-foreground text-xs">
                In cPanel → <strong>Setup Node.js App</strong>: set the Application URL to your domain.
                cPanel routes traffic automatically through Apache and its built-in SSL
                (use <strong>AutoSSL</strong> in cPanel → SSL/TLS Status to get a free certificate).
              </p>
            </div>
          </div>
        </Step>

        {/* Step 11 */}
        <Step n={11} title="Configure Email" icon={Mail}>
          <p className="text-muted-foreground">
            Email is used to send invoices to customers, statements, and your daily automatic backups.
            You configure this <strong>inside the app</strong> — no config file changes needed.
          </p>
          <ol className="list-decimal list-inside space-y-1.5 text-muted-foreground">
            <li>Go to <a href="https://resend.com" target="_blank" rel="noreferrer" className="underline text-primary">resend.com</a> and create a free account (3,000 emails/month free)</li>
            <li>Verify your sending domain in Resend (add DNS records they give you — takes ~5 minutes)</li>
            <li>In Resend, go to <strong>API Keys → Create API Key</strong> → copy it</li>
            <li>In this app go to <strong>Settings → Email</strong></li>
            <li>Paste the API key, set a From name (e.g. <em>GlobiPOS</em>) and From email</li>
            <li>Click <strong>Send Test Email</strong> to verify it works</li>
          </ol>
          <Note type="info">
            A free Resend account is more than enough for normal business use. You only need a paid
            plan if you send more than 3,000 emails per month.
          </Note>
        </Step>

        {/* Step 12 */}
        <Step n={12} title="Enable Automatic Daily Backups" icon={RefreshCw}>
          <p className="text-muted-foreground">
            Once email is working, turn on automatic backups so you always have a recent copy of your
            data emailed to you every day.
          </p>
          <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
            <li>Go to <strong>Settings → Backup &amp; Recovery → Automatic Daily Backup</strong></li>
            <li>Enter an email address where backups should be sent</li>
            <li>Toggle the switch <strong>On</strong></li>
          </ol>
          <Note type="success">
            The system sends a differential backup (only new records) automatically every 24 hours.
            If more than 8 days have passed since the last backup, it sends a full backup instead.
            Backup files are named with the date and type, e.g.{" "}
            <code className="text-xs bg-muted px-1 rounded">fc-globi-pos-ltd-backup-2026-06-26-full.json</code>
          </Note>
        </Step>

      </div>

      {/* Ongoing maintenance */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Terminal className="w-4 h-4 text-muted-foreground" />
            Day-to-day maintenance commands
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 font-semibold">What you want to do</th>
                <th className="text-left py-2 font-semibold">Command to run</th>
              </tr>
            </thead>
            <tbody className="divide-y font-mono">
              <tr><td className="py-2 font-sans font-medium">See live app logs</td><td className="py-2 text-green-700 dark:text-green-400">pm2 logs fc-globi-pos-ltd</td></tr>
              <tr><td className="py-2 font-sans font-medium">Restart the app</td><td className="py-2 text-green-700 dark:text-green-400">pm2 restart fc-globi-pos-ltd</td></tr>
              <tr><td className="py-2 font-sans font-medium">Stop the app</td><td className="py-2 text-green-700 dark:text-green-400">pm2 stop fc-globi-pos-ltd</td></tr>
              <tr><td className="py-2 font-sans font-medium">Check app status</td><td className="py-2 text-green-700 dark:text-green-400">pm2 status</td></tr>
              <tr><td className="py-2 font-sans font-medium">Update to new version</td><td className="py-2 text-green-700 dark:text-green-400">git pull && npm run build && pm2 restart fc-globi-pos-ltd</td></tr>
              <tr><td className="py-2 font-sans font-medium">Reboot server safely</td><td className="py-2 text-green-700 dark:text-green-400">sudo reboot (PM2 auto-restarts the app)</td></tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Troubleshooting */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <HelpCircle className="w-4 h-4 text-muted-foreground" />
            Troubleshooting — something isn't working?
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <div className="space-y-3">
            {[
              {
                problem: "The site shows \"502 Bad Gateway\" or \"Connection refused\"",
                fix: "The app isn't running. Check: pm2 status — if it's not 'online', run: pm2 start ecosystem.config.js",
              },
              {
                problem: "\"ECONNREFUSED\" error in pm2 logs",
                fix: "The database connection is wrong. Double-check DATABASE_URL in your .env file. Make sure the PostgreSQL service is running: sudo systemctl status postgresql",
              },
              {
                problem: "The domain shows \"This site can't be reached\"",
                fix: "DNS hasn't propagated yet (can take up to 24 hours), or Caddy/Nginx isn't running. Check: sudo systemctl status caddy",
              },
              {
                problem: "No HTTPS padlock / certificate error",
                fix: "The certificate failed. This usually means DNS wasn't pointing to the server when Caddy first started. Wait for DNS to propagate, then run: sudo systemctl restart caddy",
              },
              {
                problem: "Login fails even with correct password",
                fix: "The database might not have imported correctly. Re-run: psql \"$DATABASE_URL\" < database.sql",
              },
              {
                problem: "Emails aren't sending",
                fix: "Check Settings → Email. Make sure the Resend API key is entered and the sending domain is verified in your Resend dashboard.",
              },
              {
                problem: "\"Cannot find module\" or app crashes immediately",
                fix: "Dependencies weren't installed. Run: npm install --omit=dev && npm run build",
              },
            ].map(({ problem, fix }) => (
              <div key={problem} className="border rounded-lg p-3 space-y-1">
                <p className="font-medium text-xs flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                  {problem}
                </p>
                <p className="text-xs text-muted-foreground pl-5">{fix}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Footer */}
      <div className="text-center text-xs text-muted-foreground pb-4">
        Need help? Download the <strong>cPanel Deployment Package</strong> from Settings — it includes
        a copy of this guide plus all the config files ready to use.
        <br />
        <Link href="/settings">
          <button className="text-primary underline mt-1">← Back to Settings</button>
        </Link>
      </div>
    </div>
  );
}
