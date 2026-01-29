import express from 'express';
import { 
  addGuest, 
  getGuestsForEvent, 
  deleteGuest, 
  checkInGuest, 
  updateGuest,
  checkOutGuest,
  generateGuestTicket
} from '../services/guestlist.js';

const router = express.Router();

// GET /api/admin/guestlist/:eventId
router.get('/:eventId', async (req, res) => {
  try {
    const guests = await getGuestsForEvent(req.params.eventId);
    res.json(guests);
  } catch (error) {
    console.error('Error fetching guestlist:', error);
    res.status(500).json({ error: 'Failed to fetch guestlist' });
  }
});

// POST /api/admin/guestlist
router.post('/', async (req, res) => {
  try {
    const guest = await addGuest(req.body);
    res.status(201).json(guest);
  } catch (error) {
    console.error('Error adding guest:', error);
    res.status(500).json({ error: 'Failed to add guest' });
  }
});

// DELETE /api/admin/guestlist/:guestId
router.delete('/:guestId', async (req, res) => {
  try {
    await deleteGuest(req.params.guestId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting guest:', error);
    res.status(500).json({ error: 'Failed to delete guest' });
  }
});

// PUT /api/admin/guestlist/:guestId
router.put('/:guestId', async (req, res) => {
  try {
    const result = await updateGuest(req.params.guestId, req.body);
    res.json(result);
  } catch (error) {
    console.error('Error updating guest:', error);
    res.status(500).json({ error: 'Failed to update guest' });
  }
});

// POST /api/admin/guestlist/:guestId/generate-ticket
router.post('/:guestId/generate-ticket', async (req, res) => {
  try {
    const result = await generateGuestTicket({
      guestId: req.params.guestId,
      email: req.body.email
    });
    res.json(result);
  } catch (error) {
    console.error('Error generating ticket:', error);
    res.status(500).json({ error: error.message || 'Failed to generate ticket' });
  }
});

// PUT /api/admin/guestlist/:guestId/checkin
router.put('/:guestId/checkin', async (req, res) => {
  try {
    await checkInGuest(req.params.guestId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error checking in guest:', error);
    res.status(500).json({ error: 'Failed to check in guest' });
  }
});

// PUT /api/admin/guestlist/:guestId/checkout
router.put('/:guestId/checkout', async (req, res) => {
  try {
    await checkOutGuest(req.params.guestId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error checking out guest:', error);
    res.status(500).json({ error: 'Failed to check out guest' });
  }
});

export default router;