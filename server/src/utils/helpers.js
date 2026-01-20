/**
 * Generates a unique ticket ID
 */
export const generateTicketId = () => {
  const timestamp = Date.now().toString(36);
  const randomStr = Math.random().toString(36).substring(2, 8);
  return `VIRUS-${timestamp}-${randomStr}`.toUpperCase();
};

/**
 * Generates QR code data string
 */
export const generateTicketQRData = (ticketId, email, eventId) => {
  return `VIRUS_TICKET|${ticketId}|${eventId}|${email}`;
};

/**
 * Formats currency to EUR string
 */
export const formatCurrency = (cents) => {
  return `€${(cents / 100).toFixed(2)}`;
};

/**
 * Validates email format
 */
export const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};
