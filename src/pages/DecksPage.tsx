import { useNavigate } from "react-router-dom";
import { DeckBuilder as DeckBuilderPanel } from "@/components/DeckBuilder/DeckBuilder";

export function DecksPage() {
  const navigate = useNavigate();
  return (
    <DeckBuilderPanel
      onUseDeck={() => navigate("/battle")}
    />
  );
}
