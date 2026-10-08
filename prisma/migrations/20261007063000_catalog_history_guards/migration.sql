ALTER TABLE "Program" ADD COLUMN "catalogActive" BOOLEAN NOT NULL DEFAULT true;
-- Offer facts stay immutable; verification/current-version metadata may advance.
CREATE FUNCTION refermarket_immutable_offer_facts() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Offer history is append-only'; END IF;
 IF (to_jsonb(NEW)-ARRAY['isCurrent','validUntil','verifiedAt','verificationMethod','reviewStatus']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['isCurrent','validUntil','verifiedAt','verificationMethod','reviewStatus']) THEN RAISE EXCEPTION 'Offer facts require a new historical version'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER immutable_offer_facts BEFORE UPDATE OR DELETE ON "ProgramOffer" FOR EACH ROW EXECUTE FUNCTION refermarket_immutable_offer_facts();
CREATE TRIGGER immutable_terms_snapshots BEFORE UPDATE OR DELETE ON "ProgramTermsSnapshot" FOR EACH ROW EXECUTE FUNCTION refermarket_immutable_history();
CREATE TRIGGER immutable_source_snapshots BEFORE UPDATE OR DELETE ON "ProgramSourceSnapshot" FOR EACH ROW EXECUTE FUNCTION refermarket_immutable_history();
