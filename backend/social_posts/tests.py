from datetime import datetime, timezone

from django.test import SimpleTestCase

from social_posts import text_generation as tg
from social_posts.text_generation import MatchContext

OCCASIONS = ("announcement", "Sieg", "Niederlage", "Unentschieden")
PLATFORMS = ("facebook", "instagram", "x")


def _ctx(post_type="result", won=2, lost=1) -> MatchContext:
    return MatchContext(
        team_name="Punishers CS2",
        opponent_name="Los Pistoleros",
        post_type=post_type,
        game="Counter-Strike 2",
        competition_name="ESEA Season 12",
        match_datetime=datetime(2026, 10, 30, 19, 0, tzinfo=timezone.utc),
        team_maps_won=won if post_type == "result" else None,
        opponent_maps_won=lost if post_type == "result" else None,
    )


class StyleExampleTests(SimpleTestCase):
    def test_every_occasion_and_platform_has_an_example(self):
        for occasion in OCCASIONS:
            for platform in PLATFORMS:
                with self.subTest(occasion=occasion, platform=platform):
                    self.assertIn((occasion, platform), tg._STYLE_EXAMPLES)

    def test_examples_obey_the_rules_they_teach(self):
        # An example that itself says "wieder"/"du" or overshoots the length
        # would teach the model exactly what the guard rejects.
        for (occasion, platform), text in tg._STYLE_EXAMPLES.items():
            with self.subTest(occasion=occasion, platform=platform):
                self.assertFalse(tg._HISTORY_RE.search(text))
                self.assertFalse(tg._SINGULAR_YOU_RE.search(text))
                self.assertFalse(tg._LEADING_IHR_RE.match(text))
                self.assertLessEqual(len(text), tg._MAX_LENGTH[platform])
                self.assertTrue(any(m in text for m in tg._EXAMPLE_MARKERS))


class DraftProblemsTests(SimpleTestCase):
    facts = _ctx().facts_block()

    def problems(self, text, platform="facebook"):
        return tg._draft_problems(text, platform, self.facts)

    def test_clean_draft_passes(self):
        text = "Sieg! 🏆 2:1 Maps gegen Los Pistoleros - danke, dass ihr mitgefiebert habt! #PunishersGermany #R6"
        self.assertEqual(self.problems(text, "x"), [])

    def test_flags_invented_history_words(self):
        for word in ("wieder", "erneut", "endlich", "weiterhin", "Heute", "gestern"):
            with self.subTest(word=word):
                self.assertTrue(self.problems(f"Wir haben {word} gewonnen, 2:1 Maps."))

    def test_flags_singular_you_but_not_third_person_sie(self):
        self.assertTrue(self.problems("Danke, dass du dabei warst! 2:1"))
        self.assertEqual(self.problems("Sie haben stark gespielt, aber wir gewinnen 2:1 Maps."), [])

    def test_flags_leading_ihr(self):
        self.assertTrue(self.problems("ihr, wir sind stolz auf das 2:1"))
        self.assertTrue(self.problems("Ihr seid großartig, 2:1 Maps"))
        self.assertEqual(self.problems("Wir sind stolz, ihr seid großartig: 2:1 Maps"), [])

    def test_flags_numbers_not_in_facts(self):
        problems = self.problems("Wir haben mit 3:0 gewonnen")
        self.assertTrue(any("3" in p and "Zahlen" in p for p in problems))
        # numbers that ARE in the facts (score, date, season) are fine
        self.assertEqual(self.problems("2:1 Maps in ESEA Season 12 am 30.10.2026 um 20:00 Uhr"), [])

    def test_flags_leaked_example_names(self):
        self.assertTrue(self.problems("Wir treffen auf Team Beispiel, 2:1"))

    def test_flags_overlong_draft(self):
        self.assertTrue(self.problems("a" * (tg._MAX_LENGTH["x"] + 1), "x"))


class TrimToLimitTests(SimpleTestCase):
    def test_short_text_untouched(self):
        self.assertEqual(tg._trim_to_limit("Kurz und gut.", 100), "Kurz und gut.")

    def test_cuts_at_last_full_sentence(self):
        text = "Erster Satz ist da. Zweiter Satz folgt hier. Dritter Satz sprengt das Limit komplett."
        out = tg._trim_to_limit(text, 50)
        self.assertLessEqual(len(out), 50)
        self.assertTrue(out.endswith("."))
        self.assertIn("Zweiter Satz", out)
        self.assertNotIn("Dritter", out)

    def test_keeps_trailing_hashtag_line(self):
        text = "Satz eins ist kurz. Satz zwei ist deutlich länger als erlaubt wäre.\n\n#Esport #PunishersGermany"
        out = tg._trim_to_limit(text, 60)
        self.assertLessEqual(len(out), 60)
        self.assertTrue(out.endswith("#Esport #PunishersGermany"))

    def test_word_boundary_fallback_without_sentence_end(self):
        out = tg._trim_to_limit("wort " * 40, 30)
        self.assertLessEqual(len(out), 30)
        self.assertTrue(out.endswith("…"))


class BuildPromptTests(SimpleTestCase):
    def test_keeps_facts_and_address_rules(self):
        prompt = tg._build_prompt("facebook", _ctx())
        self.assertIn("Los Pistoleros", prompt)
        self.assertIn("'ihr'/'euch'", prompt)
        self.assertIn("NIEMALS 'du'/'dich'", prompt)
        self.assertIn("Erfinde" if "Erfinde" in prompt else "erfinde", prompt)

    def test_prompt_matches_occasion_and_platform(self):
        win = tg._build_prompt("x", _ctx(won=2, lost=0))
        loss = tg._build_prompt("x", _ctx(won=0, lost=2))
        announce = tg._build_prompt("x", _ctx(post_type="announcement"))
        self.assertIn(tg._TONE_BY_OCCASION["Sieg"], win)
        self.assertIn(tg._STYLE_EXAMPLES[("Sieg", "x")], win)
        self.assertIn(tg._TONE_BY_OCCASION["Niederlage"], loss)
        self.assertIn(tg._STYLE_EXAMPLES[("Niederlage", "x")], loss)
        self.assertIn(tg._STYLE_EXAMPLES[("announcement", "x")], announce)
        self.assertNotIn(tg._TONE_BY_OCCASION["Sieg"], loss)
        self.assertTrue(win.rstrip().endswith("ohne Vorspann."))
        self.assertIn(tg._LENGTH_RULE["x"], win)


class _FakeClient:
    def __init__(self, replies):
        self.replies = list(replies)
        self.prompts = []

    def generate(self, prompt):
        self.prompts.append(prompt)
        return self.replies.pop(0)


class GenerateCheckedTests(SimpleTestCase):
    GOOD = "Sieg! 🏆 2:1 Maps gegen Los Pistoleros - danke, dass ihr mitgefiebert habt! #PunishersGermany"
    BAD = "Wir haben endlich wieder gewonnen, 2:1 Maps gegen Los Pistoleros!"

    def test_good_first_draft_needs_no_retry(self):
        client = _FakeClient([self.GOOD])
        self.assertEqual(tg._generate_checked(client, "x", _ctx()), self.GOOD)
        self.assertEqual(len(client.prompts), 1)

    def test_bad_draft_is_rewritten_once_with_the_problems_named(self):
        client = _FakeClient([self.BAD, self.GOOD])
        self.assertEqual(tg._generate_checked(client, "x", _ctx()), self.GOOD)
        self.assertEqual(len(client.prompts), 2)
        self.assertIn("nicht brauchbar", client.prompts[1])
        self.assertIn(self.BAD, client.prompts[1])
        self.assertIn("endlich", client.prompts[1])

    def test_never_retries_more_than_once(self):
        client = _FakeClient([self.BAD, self.BAD, self.GOOD])
        tg._generate_checked(client, "x", _ctx())
        self.assertEqual(len(client.prompts), 2)

    def test_worse_rewrite_does_not_replace_the_original(self):
        original = "Wir haben endlich gewonnen, 2:1 Maps gegen Los Pistoleros!"  # 1 problem
        worse = "Wir haben endlich wieder 3:0 gewonnen, du warst dabei!"  # several problems
        client = _FakeClient([original, worse])
        self.assertEqual(tg._generate_checked(client, "x", _ctx()), original)

    def test_overlong_result_is_trimmed_to_the_platform_ceiling(self):
        long_text = "Starker Satz hier. " * 40
        client = _FakeClient([long_text, long_text])
        out = tg._generate_checked(client, "x", _ctx())
        self.assertLessEqual(len(out), tg._MAX_LENGTH["x"])
