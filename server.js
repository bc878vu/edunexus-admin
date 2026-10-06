
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;
const DB_FILE = path.join(__dirname, 'database.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

if (!fs.existsSync(DB_FILE)) {
  const initialData = {
    adminPassword: "admin",
    licenses: [
      {
        key: "EDU-VIP-101",
        user: "Test Student",
        contact: "923001234567",
        deviceId: "",
        status: "active",
        createdAt: new Date().toISOString(),
        lastActive: "Never"
      }
    ]
  };
  fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
}

function readDB() {
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
}
function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

app.post('/api/verify', (req, res) => {
  const { key, deviceId } = req.body;
  if (!key || !deviceId) {
    return res.status(400).json({ ok: false, message: "Key and Device ID are required!" });
  }

  const db = readDB();
  const lic = db.licenses.find(l => l.key.toUpperCase() === key.toUpperCase());

  if (!lic) {
    return res.status(404).json({ ok: false, message: "Invalid License Key!" });
  }

  if (lic.status === "blocked") {
    return res.status(403).json({ ok: false, blocked: true, message: "Access has been BLOCKED by Admin." });
  }

  if (!lic.deviceId) {
    lic.deviceId = deviceId; // Lock to first computer
  } else if (lic.deviceId !== deviceId) {
    return res.status(403).json({ ok: false, message: "Device Mismatch! Key already bound to another machine." });
  }

  lic.lastActive = new Date().toISOString();
  writeDB(db);

  return res.json({ ok: true, active: true, blocked: false, user: lic.user });
});

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  const db = readDB();
  if (password === db.adminPassword) {
    return res.json({ ok: true, token: "ADMIN_TOKEN" });
  }
  return res.status(401).json({ ok: false, message: "Wrong Password" });
});

app.get('/api/admin/stats', (req, res) => {
  const db = readDB();
  res.json({
    totalKeys: db.licenses.length,
    activeKeys: db.licenses.filter(l => l.status === "active").length,
    blockedKeys: db.licenses.filter(l => l.status === "blocked").length,
    licenses: db.licenses
  });
});

app.post('/api/admin/create-key', (req, res) => {
  const { user, contact } = req.body;
  const db = readDB();

  const newKey = 'EDU-' + Math.random().toString(36).substring(2, 6).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();

  const newLicense = {
    key: newKey,
    user: user || "Student",
    contact: contact || "N/A",
    deviceId: "",
    status: "active",
    createdAt: new Date().toISOString(),
    lastActive: "Never"
  };

  db.licenses.unshift(newLicense);
  writeDB(db);
  res.json({ ok: true, license: newLicense });
});

app.post('/api/admin/toggle-status', (req, res) => {
  const { key } = req.body;
  const db = readDB();
  const lic = db.licenses.find(l => l.key === key);
  if (!lic) return res.status(404).json({ ok: false });

  lic.status = lic.status === "active" ? "blocked" : "active";
  writeDB(db);
  res.json({ ok: true, status: lic.status });
});

app.post('/api/admin/reset-device', (req, res) => {
  const { key } = req.body;
  const db = readDB();
  const lic = db.licenses.find(l => l.key === key);
  if (!lic) return res.status(404).json({ ok: false });

  lic.deviceId = "";
  writeDB(db);
  res.json({ ok: true });
});

app.post('/api/admin/delete-key', (req, res) => {
  const { key } = req.body;
  const db = readDB();
  db.licenses = db.licenses.filter(l => l.key !== key);
  writeDB(db);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`EduNexus Master Admin Server running on port ${PORT}`);
  console.log(`Dashboard URL: http://localhost:${PORT}`);
});
