from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('discord_bot', '0004_copy_rule_acceptance_to_reaction_roles'),
    ]

    operations = [
        migrations.DeleteModel(
            name='RuleAcceptanceConfig',
        ),
    ]
