from app import main, models


def _make_user(email: str, name: str) -> models.User:
    return models.User(email=email, password_hash="hash", name=name)


def _make_profile(owner_user_id: int, full_name: str, created_by_user_id: int) -> models.HealthProfile:
    return models.HealthProfile(
        owner_user_id=owner_user_id,
        full_name=full_name,
        created_by_user_id=created_by_user_id,
        is_primary_profile=False,
        is_archived=False,
    )


def test_feed_profile_user_ids_include_owner_and_accepted_collaborators(db_session):
    owner = _make_user("owner@example.com", "Owner")
    accepted = _make_user("accepted@example.com", "Accepted")
    pending = _make_user("pending@example.com", "Pending")
    db_session.add_all([owner, accepted, pending])
    db_session.commit()

    profile = _make_profile(owner.id, "Paciente", owner.id)
    db_session.add(profile)
    db_session.commit()

    db_session.add_all(
        [
            models.ProfileRelationship(
                profile_id=profile.id,
                user_id=accepted.id,
                role="editor",
                status="accepted",
            ),
            models.ProfileRelationship(
                profile_id=profile.id,
                user_id=pending.id,
                role="viewer",
                status="pending",
            ),
        ]
    )
    db_session.commit()

    assert main._get_feed_profile_user_ids(db_session, profile.id) == {owner.id, accepted.id}


def test_feed_post_notification_targets_current_profile_members_only(db_session, monkeypatch):
    owner = _make_user("owner2@example.com", "Owner")
    actor = _make_user("actor2@example.com", "Actor")
    other = _make_user("other2@example.com", "Other")
    outsider = _make_user("outsider2@example.com", "Outsider")
    db_session.add_all([owner, actor, other, outsider])
    db_session.commit()

    profile = _make_profile(owner.id, "Paciente Feed", owner.id)
    db_session.add(profile)
    db_session.commit()

    db_session.add_all(
        [
            models.ProfileRelationship(profile_id=profile.id, user_id=actor.id, role="editor", status="accepted"),
            models.ProfileRelationship(profile_id=profile.id, user_id=other.id, role="viewer", status="accepted"),
        ]
    )
    db_session.commit()

    post = models.FeedPost(
        user_id=actor.id,
        profile_id=profile.id,
        content="Actualizacion familiar",
        post_type="general",
        privacy="family",
    )
    db_session.add(post)
    db_session.commit()
    db_session.refresh(post)

    sent_to = []

    def fake_send_push(db, user_id, payload):
        sent_to.append((user_id, payload.get("url")))
        return 1

    monkeypatch.setattr(main, "_send_push_to_user", fake_send_push)

    main._send_feed_notification_to_family(db_session, actor, post, "post")

    assert sorted(sent_to) == sorted(
        [
            (owner.id, f"/family?postId={post.id}"),
            (other.id, f"/family?postId={post.id}"),
        ]
    )
    assert outsider.id not in [user_id for user_id, _ in sent_to]


def test_feed_comment_notifications_reach_all_profile_members(db_session, monkeypatch):
    owner = _make_user("owner3@example.com", "Owner")
    actor = _make_user("actor3@example.com", "Actor")
    other = _make_user("other3@example.com", "Other")
    db_session.add_all([owner, actor, other])
    db_session.commit()

    profile = _make_profile(owner.id, "Paciente Comentarios", owner.id)
    db_session.add(profile)
    db_session.commit()

    db_session.add_all(
        [
            models.ProfileRelationship(profile_id=profile.id, user_id=actor.id, role="editor", status="accepted"),
            models.ProfileRelationship(profile_id=profile.id, user_id=other.id, role="viewer", status="accepted"),
        ]
    )
    db_session.commit()

    post = models.FeedPost(
        user_id=owner.id,
        profile_id=profile.id,
        content="Post del grupo",
        post_type="general",
        privacy="family",
    )
    db_session.add(post)
    db_session.commit()
    db_session.refresh(post)

    comment = models.PostComment(
        post_id=post.id,
        user_id=actor.id,
        content="Comentario de prueba",
        mentions_json="[]",
    )
    db_session.add(comment)
    db_session.commit()
    db_session.refresh(comment)

    sent_to = []

    def fake_send_push(db, user_id, payload):
        sent_to.append((user_id, payload.get("tag")))
        return 1

    monkeypatch.setattr(main, "_send_push_to_user", fake_send_push)

    main._send_feed_comment_notifications(
        db_session,
        actor,
        post,
        comment,
        mention_user_ids=[],
        parent_comment=None,
    )

    recipient_ids = {user_id for user_id, _ in sent_to}
    assert recipient_ids == {owner.id, other.id}
    assert actor.id not in recipient_ids
