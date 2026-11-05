const categories = [
  {
    key: "general_support",
    label: "General Support",
    emoji: "❕",
    description: "Ask a question or report an issue.",
    roleEnv: "GENERAL_SUPPORT_ROLE_ID",
    questions: [
      "Briefly describe your question or issue.",
      "Include any relevant screenshots or details."
    ]
  },
  {
    key: "esports_application",
    label: "Esports Application",
    emoji: "⚔️",
    description: "Apply to compete under the Vyuh Esports banner.",
    roleEnv: "ESPORTS_APPLICATION_ROLE_ID",
    questions: [
      "What is your in-game name and player tag?",
      "What is your Town Hall level?",
      "What competitive experience do you have?"
    ]
  },
  // {
  //   key: "base_access",
  //   label: "Base Access & Orders",
  //   emoji: "🏰",
  //   description: "Ask about base layouts, access, or custom orders.",
  //   roleEnv: "BASE_ACCESS_ROLE_ID",
  //   questions: [
  //     "What base or service do you need?",
  //     "Include your Town Hall level and any requirements."
  //   ]
  // },
  {
    key: "report_player",
    label: "Report a Player",
    emoji: "🚩",
    description: "Submit a player report privately to staff.",
    roleEnv: "REPORT_PLAYER_ROLE_ID",
    questions: [
      "Who are you reporting? Include their in-game name/tag.",
      "What happened, and when?",
      "Provide evidence if available."
    ]
  },
  {
    key: "sponsorship",
    label: "Sponsorship & Promotion",
    emoji: "💰",
    description: "Discuss sponsorships, partnerships, or promotion.",
    roleEnv: "SPONSORSHIP_ROLE_ID",
    questions: [
      "What brand or organization do you represent?",
      "What type of collaboration are you proposing?",
      "Include links or relevant details."
    ]
  },
  {
    key: "staff_application",
    label: "Staff Application",
    emoji: "🛠️",
    description: "Apply to join the Vyuh Esports staff team.",
    roleEnv: "STAFF_APPLICATION_ROLE_ID",
    questions: [
      "What role are you applying for?",
      "What experience do you have?",
      "Why do you want to join Vyuh Esports?"
    ]
  }
];

module.exports = categories;