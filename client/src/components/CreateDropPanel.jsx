import { useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from './Button';
import { api, ApiError } from '../lib/api';

const EMPTY = {
  name: '',
  description: '',
  price: '',
  totalStock: '',
  reservationWindowSeconds: '60',
  startsAt: '',
  endsAt: '',
};

/**
 * A thin front-end over POST /api/drops. The spec does not require an admin UI,
 * but having one makes the two-window demo (and the stress test) far easier to
 * set up than reaching for curl.
 */
export function CreateDropPanel({ onCreated, onClose }) {
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  const update = (field) => (event) => setForm((prev) => ({ ...prev, [field]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();

    const priceDollars = Number.parseFloat(form.price);
    const totalStock = Number.parseInt(form.totalStock, 10);

    if (!form.name.trim()) return toast.error('Give the drop a name.');
    if (!Number.isFinite(priceDollars) || priceDollars < 0) return toast.error('Enter a valid price.');
    if (!Number.isFinite(totalStock) || totalStock < 1) return toast.error('Stock must be at least 1.');

    setSaving(true);
    try {
      const { drop } = await api.createDrop({
        name: form.name.trim(),
        description: form.description.trim() || null,
        // Dollars in the UI, integer cents on the wire — no floats in the DB.
        priceCents: Math.round(priceDollars * 100),
        totalStock,
        reservationWindowSeconds: Number.parseInt(form.reservationWindowSeconds, 10) || 60,
        // datetime-local gives a local wall-clock string; toISOString normalises
        // it to UTC so the server stores an unambiguous instant.
        startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : undefined,
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : undefined,
      });

      toast.success(`Created "${drop.name}" with ${drop.totalStock} units.`);
      setForm(EMPTY);
      onCreated?.(drop);
      onClose?.();
    } catch (error) {
      const detail = error instanceof ApiError && error.details?.[0];
      toast.error(detail ? `${detail.field}: ${detail.message}` : error.message);
    } finally {
      setSaving(false);
    }
  };

  const field =
    'mt-1 w-full rounded-lg bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 ' +
    'ring-1 ring-inset ring-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-500';
  const label = 'block text-xs font-semibold uppercase tracking-wider text-zinc-500';

  return (
    <form
      onSubmit={submit}
      className="animate-fade-slide-in mb-6 rounded-xl bg-zinc-900 p-5 ring-1 ring-inset ring-zinc-800"
    >
      <h2 className="text-sm font-semibold text-zinc-100">Initialise a merch drop</h2>
      <p className="mt-0.5 text-xs text-zinc-500">
        POST /api/drops — stock starts fully available; holds and sales are derived, never set here.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className={label}>Name</span>
          <input className={field} value={form.name} onChange={update('name')} placeholder="Air Jordan 1 — Chicago" maxLength={120} />
        </label>

        <label className="sm:col-span-2">
          <span className={label}>Description</span>
          <input className={field} value={form.description} onChange={update('description')} placeholder="Optional" maxLength={2000} />
        </label>

        <label>
          <span className={label}>Price (USD)</span>
          <input className={field} value={form.price} onChange={update('price')} inputMode="decimal" placeholder="220.00" />
        </label>

        <label>
          <span className={label}>Total stock</span>
          <input className={field} value={form.totalStock} onChange={update('totalStock')} inputMode="numeric" placeholder="100" />
        </label>

        <label>
          <span className={label}>Hold window (seconds)</span>
          <input className={field} value={form.reservationWindowSeconds} onChange={update('reservationWindowSeconds')} inputMode="numeric" />
        </label>

        <label>
          <span className={label}>Starts at</span>
          <input className={field} type="datetime-local" value={form.startsAt} onChange={update('startsAt')} />
          <span className="mt-1 block text-xs text-zinc-600">Blank = live immediately</span>
        </label>

        <label>
          <span className={label}>Ends at</span>
          <input className={field} type="datetime-local" value={form.endsAt} onChange={update('endsAt')} />
          <span className="mt-1 block text-xs text-zinc-600">Blank = runs until sold out</span>
        </label>
      </div>

      <div className="mt-4 flex gap-2">
        <Button type="submit" loading={saving} loadingLabel="Creating…">
          Create drop
        </Button>
        <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
