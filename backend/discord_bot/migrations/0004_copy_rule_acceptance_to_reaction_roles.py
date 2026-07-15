from django.db import migrations


def copy_rule_acceptance_to_reaction_roles(apps, schema_editor):
    RuleAcceptanceConfig = apps.get_model('discord_bot', 'RuleAcceptanceConfig')
    ReactionRole = apps.get_model('discord_bot', 'ReactionRole')
    for rac in RuleAcceptanceConfig.objects.all():
        ReactionRole.objects.update_or_create(
            guild=rac.guild,
            message_id=rac.message_id,
            emoji=rac.emoji,
            defaults={
                'channel_id': rac.rules_channel_id,
                'role_id': rac.role_id,
                'label': 'Regel-Akzeptanz',
                'removable': False,
                'enabled': rac.enabled,
            },
        )


class Migration(migrations.Migration):

    dependencies = [
        ('discord_bot', '0003_reactionrole'),
    ]

    operations = [
        # Reverse is deliberately a no-op, not a re-split back into
        # RuleAcceptanceConfig rows - this is a small internal admin tool
        # with one operator, not a system where automatic migration
        # rollback safety across this boundary is worth the complexity.
        migrations.RunPython(copy_rule_acceptance_to_reaction_roles, migrations.RunPython.noop),
    ]
