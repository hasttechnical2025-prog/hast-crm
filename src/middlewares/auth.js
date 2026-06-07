const { verifyJWT } = require('../utils/crypto');
const { supabase } = require('../config');

async function authenticateRequest(token) {
  if (!token) {
    const error = new Error('UNAUTHORIZED: Thiếu token xác thực');
    error.code = 'UNAUTHORIZED';
    throw error;
  }

  // Verify JWT signature & expiration
  const jwtPayload = verifyJWT(token);
  if (!jwtPayload) {
    const error = new Error('UNAUTHORIZED: Token không hợp lệ hoặc đã hết hạn');
    error.code = 'UNAUTHORIZED';
    throw error;
  }

  // Verify session in Supabase DB
  const { data: session, error: sessionErr } = await supabase
    .from('crm_sessions')
    .select('id, is_deleted, expired_at')
    .eq('token', token)
    .single();

  if (sessionErr || !session) {
    const error = new Error('UNAUTHORIZED: Session không tồn tại');
    error.code = 'UNAUTHORIZED';
    throw error;
  }
  if (session.is_deleted) {
    const error = new Error('UNAUTHORIZED: Session đã bị thu hồi');
    error.code = 'UNAUTHORIZED';
    throw error;
  }
  if (new Date(session.expired_at) < new Date()) {
    const error = new Error('UNAUTHORIZED: Session đã hết hạn');
    error.code = 'UNAUTHORIZED';
    throw error;
  }

  // Lấy thông tin user
  const { data: user, error: userErr } = await supabase
    .from('crm_users')
    .select('*')
    .eq('id', jwtPayload.userId)
    .single();

  if (userErr || !user || user.is_deleted || user.status !== 'active') {
    const error = new Error('UNAUTHORIZED: Người dùng không hợp lệ hoặc đã bị khóa');
    error.code = 'UNAUTHORIZED';
    throw error;
  }

  return user;
}

function handleError(err, res) {
  const message = err.message || String(err);
  let code = err.code || 'INTERNAL_ERROR';
  let statusCode = 500;

  if (message.startsWith('UNAUTHORIZED') || code === 'UNAUTHORIZED') {
    code = 'UNAUTHORIZED';
    statusCode = 401;
  } else if (message.startsWith('FORBIDDEN') || code === 'FORBIDDEN') {
    code = 'FORBIDDEN';
    statusCode = 403;
  } else if (message.includes('không hợp lệ') || message.includes('Thiếu') || code === 'BAD_REQUEST') {
    code = 'BAD_REQUEST';
    statusCode = 400;
  }

  console.error(`[${code}] ${message}`);
  return res.status(statusCode).json({
    success: false,
    error: {
      code: code,
      message: message
    }
  });
}

module.exports = {
  authenticateRequest,
  handleError
};