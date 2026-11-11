import { Link } from "react-router-dom";
import { BrandMark } from "../components/Brand";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center py-24 text-center">
      <BrandMark size={64} />
      <h1 className="mt-6 font-display text-6xl">Signal lost.</h1>
      <p className="mt-2 text-ink-2">This route does not exist in TRANZIQ.</p>
      <Link to="/" className="btn-primary mt-6">Back to Command Center</Link>
    </div>
  );
}
