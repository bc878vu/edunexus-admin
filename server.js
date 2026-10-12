
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

const EDUNEXUS_SUPABASE_URL = 'https://cprpndovdfnkvekewstv.supabase.co';
const EDUNEXUS_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNwcnBuZG92ZGZua3Zla2V3c3R2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0MTcwMjgsImV4cCI6MjEwNDk5MzAyOH0.e2R0UMJYnWaLyqpvzfH_Z6SEYAQGGQmlSiPmA0tJPxg';

function safeSupabaseUrl(value) {
  const url = String(value || '').trim().replace(/\/+$/, '');
  return url.includes('cprpndovdfnkvekewstv.supabase.co')
    ? url
    : EDUNEXUS_SUPABASE_URL;
}

function safeSupabaseKey(value) {
  const key = String(value || '').trim();
  return key && key.includes('eyJ')
    ? key
    : EDUNEXUS_SUPABASE_ANON_KEY;
}

const SUPABASE_URL = safeSupabaseUrl(process.env.SUPABASE_URL);
const SUPABASE_ANON_KEY = safeSupabaseKey(process.env.SUPABASE_ANON_KEY);
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
    ],
    maxAge: 86400
  })
);

app.use(express.json({ limit: '32kb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', req.path.startsWith('/api/') ? 'no-store' : 'no-cache');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

function adminToken(req) {
  const auth = String(req.headers.authorization || '');
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return String(req.headers['x-admin-token'] || '').trim();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function callRpc(functionName, params = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetchWithTimeout(
        RPC_BASE + '/' + functionName,
        {
          method: 'POST',
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          body: JSON.stringify(params)
        }
      );

      const raw = await response.text();

      let data;
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
          (data && (data.message || data.error_description || data.hint || data.details)) ||
          'Database API request failed.';

        const error = new Error(message);
        error.status = response.status >= 400 ? response.status : 502;
        error.upstream = data;
        error.rpc = functionName;
        throw error;
      }

      return data;
    } catch (error) {
      lastError = error;

      if (attempt < 2) {
        await sleep(250);
        continue;
      }
    }
  }

  throw lastError || new Error('Unknown database connection error.');
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
    const startedAt = Date.now();
    const data = await callRpc('edunexus_admin_health', {});

    return res.json({
      ...data,
      server: 'online',
      database: data && data.ok ? 'online' : 'unknown',
      projectRef: 'cprpndovdfnkvekewstv',
      latencyMs: Date.now() - startedAt
    });
  })
);

app.get('/api/verify', (_req, res) => {
  res.status(405).json({
    ok: false,
    message: 'Use POST /api/verify with JSON body: { key, deviceId }.'
  });
});

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
    rpc: error && error.rpc,
    upstream: error && error.upstream
  });

  res.status(status).json({
    ok: false,
    message: aborted
      ? 'Admin database request timed out.'
      : 'Could not connect to the persistent admin database.',
    errorCode: aborted ? 'DB_TIMEOUT' : 'DB_CONNECTION_FAILED',
    rpc: error && error.rpc ? error.rpc : undefined,
    upstreamStatus: Number(error && error.status) || undefined
  });
});

app.listen(PORT, () => {
  console.log('EduNexus Admin Server running on port ' + PORT);
  console.log('Persistent storage: Supabase');
  console.log('Supabase project: cprpndovdfnkvekewstv');
});

module.exports = app;
