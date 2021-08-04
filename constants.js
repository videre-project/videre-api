/**
 * Response templates for consistent RESTful responses.
 */
export const TEMPLATES = {
    BAD_REQUEST: {
        "object": "error",
        "code": "bad_request",
        "status": 400
    },
    NOT_FOUND: {
        "object": "error",
        "code": "not_found",
        "status": 404
    }
}

/**
 * Magic: The Gathering Online supported formats, sanctioned event types, colors, card types, etc.
 */
export const MTGO = {
    FORMATS: [
        'standard',
        'pioneer',
        'modern',
        'legacy',
        'vintage',
        'pauper'
    ],
    EVENT_TYPES: [
        'mocs',
        'preliminary',
        'challenge',
        'champs',
        'premier',
        'super-qualifier',
        'players-tour-qualifier',
        'showcase-challenge',
    ],
    COLORS: [
        'C',
        'W',
        'U',
        'B',
        'R',
        'G'
    ],
    CARD_TYPES: [
        'Creature',
        'Planeswalker',
        'Artifact',
        'Enchantment',
        'Instant',
        'Sorcery',
        'Land'
    ],
    COMPANIONS: [
        'Gyruda, Doom of Depths',
        'Jegantha, the Wellspring',
        'Kaheera, the Orphanguard',
        'Keruga, the Macrosage',
        'Lurrus of the Dream-Den',
        'Lutri, the Spellchaser',
        'Obosh, the Preypiercer',
        'Umori, the Collector',
        'Yorion, Sky Nomad',
        'Zirda, the Dawnwaker',
    ]
}