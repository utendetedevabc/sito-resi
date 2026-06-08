export function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Autenticazione richiesta' });
    }
    if (!allowedRoles.includes(req.user.ruolo)) {
      return res.status(403).json({ error: 'Accesso negato' });
    }
    next();
  };
}
