import Anthropic from "@anthropic-ai/sdk";

/**
 * Assistant de discussion — LECTURE SEULE.
 * Il répond aux questions de l'aidante à partir de faits fournis par le serveur.
 * Il n'a aucun port de paiement, aucune clé, aucun outil : il ne peut que parler.
 */
export interface AssistantPort {
  answer(question: string, facts: Record<string, unknown>): Promise<string>;
}

const SYSTEM = `Tu es l'assistant de CareGuard, le portefeuille santé d'un senior géré par un aidant familial.
Tu réponds en français simple, en 1 à 4 phrases, sans jargon, en vouvoyant.
Tu t'appuies UNIQUEMENT sur les faits fournis (profil, plafonds, transactions, barème). Si l'information n'y est pas, dis-le.
Les montants des faits sont en centimes : convertis-les en euros.
Tu ne peux effectuer AUCUNE action : ni payer, ni valider, ni ajouter un soignant, ni modifier une règle.
Si on te le demande, explique que les paiements partent uniquement d'une facture déposée
et que les validations se font avec les boutons de l'écran.
Tu ne donnes pas d'avis médical. Rappelle si utile que les montants sont des estimations.`;

export class ClaudeAssistant implements AssistantPort {
  private client: Anthropic;
  constructor(apiKey: string, private model = "claude-sonnet-5-5") {
    this.client = new Anthropic({ apiKey });
  }

  async answer(question: string, facts: Record<string, unknown>): Promise<string> {
    const msg = await this.client.messages.create({
      model: this.model,
      max_tokens: 500,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Faits du foyer :\n${JSON.stringify(facts)}\n\nQuestion de l'aidante :\n${question}`,
        },
      ],
    });
    return msg.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
  }
}

/** Sans clé API : quelques réponses calculées, le reste renvoie vers le mode en ligne */
export class OfflineAssistant implements AssistantPort {
  async answer(question: string, facts: Record<string, unknown>): Promise<string> {
    const p = facts.plafonds as
      | { franchises: { deja: number; max: number }; participations: { deja: number; max: number } }
      | undefined;
    const eur = (c: number) => (c / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

    if (p && /franchise/i.test(question)) {
      return `Cette année, ${eur(p.franchises.deja)} de franchises ont été retenus sur un plafond de ${eur(p.franchises.max)}. Il en reste ${eur(Math.max(0, p.franchises.max - p.franchises.deja))} avant que les retenues s'arrêtent.`;
    }
    if (p && /participation/i.test(question)) {
      return `Cette année, ${eur(p.participations.deja)} de participations forfaitaires ont été retenus sur un plafond de ${eur(p.participations.max)}.`;
    }
    if (/pa(ie|yer)|vir(e|er)|transf|valide/i.test(question)) {
      return "Je ne peux pas déclencher de paiement depuis la discussion. Déposez la facture, et validez avec les boutons de l'écran.";
    }
    return "Mode hors ligne : je réponds seulement sur les franchises et les participations. Ajoutez une clé API pour poser d'autres questions.";
  }
}
