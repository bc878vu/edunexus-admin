
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  'https://cprpndovdfnkvekewstv.supabase.co';

const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNwcnBuZG92ZGZua3Zla2V3c3R2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0MTcwMjgsImV4cCI6MjEwNDk5MzAyOH0.e2R0UMJYnWaLyqpvzfH_Z6SEYAQGGQmlSiPmA0tJPxg';

const RPC_BASE = SUPABASE_URL + '/rest/v1/rpc';

app.disable('x-powered-by');

app.use(
  cors({
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Admin-Token'
    ]
  })
);

app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function adminToken(req) {
  const auth = String(req.headers.authorization || '');
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return String(req.headers['x-admin-token'] || '').trim();
}

async function callRpc(functionName, params = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(RPC_BASE + '/' + functionName, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(params),
      signal: controller.signal
    });

    const raw = await response.text();

    let data = null;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = {
        ok: false,
        message: raw || 'Invalid response from database API.'
      };
    }

    if (!response.ok) {
      const message =
        (data && (data.message || data.error_description || data.hint)) ||
        'Database API request failed.';

      const error = new Error(message);
      error.status = response.status >= 400 ? response.status : 502;
      error.upstream = data;
      throw error;
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function sendRpcResult(res, data) {
  const requestedStatus = Number(data && data.httpStatus);
  const status =
    Number.isInteger(requestedStatus) &&
    requestedStatus >= 400 &&
    requestedStatus <= 599
      ? requestedStatus
      : 200;

  if (data && typeof data === 'object') {
    const clean = { ...data };
    delete clean.httpStatus;
    return res.status(status).json(clean);
  }

  return res.status(status).json(data);
}

function asyncRoute(handler) {
  return function wrapped(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

app.get(
  '/api/health',
  asyncRoute(async (_req, res) => {
    const data = await callRpc('edunexus_admin_health', {});
    return sendRpcResult(res, data);
  })
);

app.post(
  '/api/verify',
  asyncRoute(async (req, res) => {
    const data = await callRpc('edunexus_license_verify', {
      p_key: req.body && req.body.key,
      p_device_id: req.body && req.body.deviceId
    });

    return sendRpcResult(res, data);
  })
);

app.post(
  '/api/admin/login',
  asyncRoute(async (req, res) => {
    const data = await callRpc('edunexus_admin_login', {
      p_password: req.body && req.body.password
    });

    return sendRpcResult(res, data);
  })
);

app.post(
  '/api/admin/logout',
  asyncRoute(async (req, res) => {
    const data = await callRpc('edunexus_admin_logout', {
      p_token: adminToken(req)
    });

    return sendRpcResult(res, data);
  })
);

app.get(
  '/api/admin/stats',
  asyncRoute(async (req, res) => {
    const data = await callRpc('edunexus_admin_stats', {
      p_token: adminToken(req)
    });

    return sendRpcResult(res, data);
  })
);

app.post(
  '/api/admin/create-key',
  asyncRoute(async (req, res) => {
    const data = await callRpc('edunexus_admin_create_key', {
      p_token: adminToken(req),
      p_user: req.body && req.body.user,
      p_contact: req.body && req.body.contact
    });

    return sendRpcResult(res, data);
  })
);

app.post(
  '/api/admin/toggle-status',
  asyncRoute(async (req, res) => {
    const data = await callRpc('edunexus_admin_toggle_status', {
      p_token: adminToken(req),
      p_key: req.body && req.body.key
    });

    return sendRpcResult(res, data);
  })
);

app.post(
  '/api/admin/reset-device',
  asyncRoute(async (req, res) => {
    const data = await callRpc('edunexus_admin_reset_device', {
      p_token: adminToken(req),
      p_key: req.body && req.body.key
    });

    return sendRpcResult(res, data);
  })
);

app.post(
  '/api/admin/update-license',
  asyncRoute(async (req, res) => {
    const data = await callRpc('edunexus_admin_update_license', {
      p_token: adminToken(req),
      p_key: req.body && req.body.key,
      p_user: req.body && req.body.user,
      p_contact: req.body && req.body.contact
    });

    return sendRpcResult(res, data);
  })
);

app.post(
  '/api/admin/delete-key',
  asyncRoute(async (req, res) => {
    const data = await callRpc('edunexus_admin_delete_key', {
      p_token: adminToken(req),
      p_key: req.body && req.body.key
    });

    return sendRpcResult(res, data);
  })
);

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((error, req, res, _next) => {
  const aborted =
    error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError');

  const status = Number(error && error.status) || (aborted ? 504 : 502);

  console.error('Admin API error:', {
    path: req.path,
    message: error && error.message,
    upstream: error && error.upstream
  });

  res.status(status).json({
    ok: false,
    message: aborted
      ? 'Admin database request timed out.'
      : 'Could not connect to the persistent admin database.',
    detail:
      process.env.NODE_ENV === 'production'
        ? undefined
        : String((error && error.message) || error)
  });
});

app.listen(PORT, () => {
  console.log('EduNexus Admin Server running on port ' + PORT);
  console.log('Persistent storage: Supabase');
  console.log('Dashboard URL: http://localhost:' + PORT);
});

module.exports = app;
