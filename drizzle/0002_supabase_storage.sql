-- Private bucket for receipts, invoice PDFs and contracts (15 MB per file).
-- No storage policies: only the server, using the service role key, can read or write it.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('attachments', 'attachments', false, 15728640)
ON CONFLICT (id) DO NOTHING;
