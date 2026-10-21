DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM wecom_connections c JOIN knowledge_bases kb ON kb.id = c.knowledge_base_id
      WHERE c.tenant_id <> kb.tenant_id
    UNION ALL
    SELECT 1 FROM external_contacts ec JOIN wecom_connections c ON c.id = ec.connection_id
      WHERE ec.tenant_id <> c.tenant_id
    UNION ALL
    SELECT 1 FROM conversations c JOIN wecom_connections w ON w.id = c.connection_id
      WHERE c.tenant_id <> w.tenant_id
    UNION ALL
    SELECT 1 FROM conversations c JOIN external_contacts ec ON ec.id = c.external_contact_id
      WHERE c.tenant_id <> ec.tenant_id OR c.connection_id IS DISTINCT FROM ec.connection_id
    UNION ALL
    SELECT 1 FROM conversations c LEFT JOIN tenant_members tm
      ON tm.tenant_id = c.tenant_id AND tm.user_id = c.assigned_user_id
      WHERE c.assigned_user_id IS NOT NULL AND (tm.user_id IS NULL OR tm.status <> 'active')
    UNION ALL
    SELECT 1 FROM messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE m.tenant_id <> c.tenant_id OR (m.connection_id IS NOT NULL AND m.connection_id IS DISTINCT FROM c.connection_id)
    UNION ALL
    SELECT 1 FROM messages m JOIN wecom_connections c ON c.id = m.connection_id
      WHERE m.tenant_id <> c.tenant_id
    UNION ALL
    SELECT 1 FROM knowledge_documents d JOIN knowledge_bases b ON b.id = d.knowledge_base_id
      WHERE d.tenant_id <> b.tenant_id
    UNION ALL
    SELECT 1 FROM knowledge_documents d JOIN knowledge_categories c ON c.id = d.category_id
      WHERE d.tenant_id <> c.tenant_id OR d.knowledge_base_id <> c.knowledge_base_id
    UNION ALL
    SELECT 1 FROM knowledge_categories c JOIN knowledge_bases b ON b.id = c.knowledge_base_id
      WHERE c.tenant_id <> b.tenant_id
    UNION ALL
    SELECT 1 FROM knowledge_chunks c JOIN knowledge_documents d ON d.id = c.document_id
      WHERE c.tenant_id <> d.tenant_id
    UNION ALL
    SELECT 1 FROM knowledge_gaps g JOIN conversations c ON c.id = g.conversation_id
      WHERE g.tenant_id <> c.tenant_id
    UNION ALL
    SELECT 1 FROM knowledge_gaps g JOIN messages m ON m.id = g.customer_message_id
      WHERE g.tenant_id <> m.tenant_id OR g.conversation_id <> m.conversation_id
    UNION ALL
    SELECT 1 FROM knowledge_gaps g JOIN knowledge_bases b ON b.id = g.knowledge_base_id
      WHERE g.tenant_id <> b.tenant_id
    UNION ALL
    SELECT 1 FROM reply_drafts d JOIN conversations c ON c.id = d.conversation_id
      WHERE d.tenant_id <> c.tenant_id
    UNION ALL
    SELECT 1 FROM auto_draft_jobs j JOIN conversations c ON c.id = j.conversation_id
      WHERE j.tenant_id <> c.tenant_id
    UNION ALL
    SELECT 1 FROM auto_draft_jobs j JOIN messages m ON m.id = j.customer_message_id
      WHERE j.tenant_id <> m.tenant_id OR j.conversation_id <> m.conversation_id
  ) THEN
    RAISE EXCEPTION 'Tenant consistency migration blocked: cross-tenant or mismatched parent records exist. Audit the affected relations before retrying.';
  END IF;
END $$;

CREATE FUNCTION enforce_tenant_reference() RETURNS trigger AS $$
DECLARE
  reference_value text;
  child_tenant text;
  reference_tenant text;
  reference_scope text;
  child_scope text;
BEGIN
  reference_value := to_jsonb(NEW) ->> TG_ARGV[0];
  IF reference_value IS NULL THEN
    RETURN NEW;
  END IF;

  child_tenant := to_jsonb(NEW) ->> 'tenant_id';
  IF TG_ARGV[1] = 'tenant_members' THEN
    EXECUTE format(
      'SELECT tenant_id::text FROM %I WHERE %I::text = $1 AND tenant_id::text = $2 AND status = ''active''',
      TG_ARGV[1], TG_ARGV[2]
    ) INTO reference_tenant USING reference_value, child_tenant;
  ELSIF TG_ARGV[3] <> '' THEN
    EXECUTE format(
      'SELECT tenant_id::text, %I::text FROM %I WHERE %I::text = $1',
      TG_ARGV[3], TG_ARGV[1], TG_ARGV[2]
    ) INTO reference_tenant, reference_scope USING reference_value;
    child_scope := to_jsonb(NEW) ->> TG_ARGV[4];
    IF reference_scope IS DISTINCT FROM child_scope
      AND NOT (child_scope IS NULL AND TG_ARGV[5] = 'allow_null_child_scope') THEN
      RAISE EXCEPTION 'Tenant relation scope mismatch on %.%', TG_TABLE_NAME, TG_ARGV[0]
        USING ERRCODE = '23514';
    END IF;
  ELSE
    EXECUTE format(
      'SELECT tenant_id::text FROM %I WHERE %I::text = $1',
      TG_ARGV[1], TG_ARGV[2]
    ) INTO reference_tenant USING reference_value;
  END IF;

  IF reference_tenant IS DISTINCT FROM child_tenant THEN
    RAISE EXCEPTION 'Tenant relation mismatch on %.%', TG_TABLE_NAME, TG_ARGV[0]
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wecom_connections_knowledge_base_tenant_guard
  BEFORE INSERT OR UPDATE OF tenant_id, knowledge_base_id ON wecom_connections
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_reference('knowledge_base_id', 'knowledge_bases', 'id', '', '');

CREATE TRIGGER external_contacts_connection_tenant_guard
  BEFORE INSERT OR UPDATE OF tenant_id, connection_id ON external_contacts
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_reference('connection_id', 'wecom_connections', 'id', '', '');

CREATE TRIGGER conversations_connection_tenant_guard
  BEFORE INSERT OR UPDATE OF tenant_id, connection_id ON conversations
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_reference('connection_id', 'wecom_connections', 'id', '', '');

CREATE TRIGGER conversations_contact_tenant_guard
  BEFORE INSERT OR UPDATE OF tenant_id, connection_id, external_contact_id ON conversations
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_reference('external_contact_id', 'external_contacts', 'id', 'connection_id', 'connection_id');

CREATE TRIGGER conversations_assignee_membership_guard
  BEFORE INSERT OR UPDATE OF tenant_id, assigned_user_id ON conversations
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_reference('assigned_user_id', 'tenant_members', 'user_id', '', '');

CREATE TRIGGER messages_conversation_tenant_guard
  BEFORE INSERT OR UPDATE OF tenant_id, conversation_id ON messages
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_reference('conversation_id', 'conversations', 'id', '', '');

CREATE TRIGGER messages_conversation_connection_scope_guard
  BEFORE INSERT OR UPDATE OF tenant_id, conversation_id, connection_id ON messages
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_reference('conversation_id', 'conversations', 'id', 'connection_id', 'connection_id', 'allow_null_child_scope');

CREATE TRIGGER messages_connection_tenant_guard
  BEFORE INSERT OR UPDATE OF tenant_id, connection_id ON messages
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_reference('connection_id', 'wecom_connections', 'id', '', '');

CREATE TRIGGER knowledge_documents_base_tenant_guard
  BEFORE INSERT OR UPDATE OF tenant_id, knowledge_base_id ON knowledge_documents
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_reference('knowledge_base_id', 'knowledge_bases', 'id', '', '');

CREATE TRIGGER knowledge_documents_category_scope_guard
  BEFORE INSERT OR UPDATE OF tenant_id, knowledge_base_id, category_id ON knowledge_documents
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_reference('category_id', 'knowledge_categories', 'id', 'knowledge_base_id', 'knowledge_base_id');

CREATE TRIGGER knowledge_categories_base_tenant_guard
  BEFORE INSERT OR UPDATE OF tenant_id, knowledge_base_id ON knowledge_categories
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_reference('knowledge_base_id', 'knowledge_bases', 'id', '', '');

CREATE TRIGGER knowledge_chunks_document_tenant_guard
  BEFORE INSERT OR UPDATE OF tenant_id, document_id ON knowledge_chunks
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_reference('document_id', 'knowledge_documents', 'id', '', '');

CREATE TRIGGER knowledge_gaps_conversation_tenant_guard
  BEFORE INSERT OR UPDATE OF tenant_id, conversation_id ON knowledge_gaps
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_reference('conversation_id', 'conversations', 'id', '', '');

CREATE TRIGGER knowledge_gaps_message_scope_guard
  BEFORE INSERT OR UPDATE OF tenant_id, conversation_id, customer_message_id ON knowledge_gaps
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_reference('customer_message_id', 'messages', 'id', 'conversation_id', 'conversation_id');

CREATE TRIGGER knowledge_gaps_base_tenant_guard
  BEFORE INSERT OR UPDATE OF tenant_id, knowledge_base_id ON knowledge_gaps
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_reference('knowledge_base_id', 'knowledge_bases', 'id', '', '');

CREATE TRIGGER reply_drafts_conversation_tenant_guard
  BEFORE INSERT OR UPDATE OF tenant_id, conversation_id ON reply_drafts
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_reference('conversation_id', 'conversations', 'id', '', '');

CREATE TRIGGER auto_draft_jobs_conversation_tenant_guard
  BEFORE INSERT OR UPDATE OF tenant_id, conversation_id ON auto_draft_jobs
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_reference('conversation_id', 'conversations', 'id', '', '');

CREATE TRIGGER auto_draft_jobs_message_scope_guard
  BEFORE INSERT OR UPDATE OF tenant_id, conversation_id, customer_message_id ON auto_draft_jobs
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_reference('customer_message_id', 'messages', 'id', 'conversation_id', 'conversation_id');
