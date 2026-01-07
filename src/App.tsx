import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { ScrollToTop } from "./components/ScrollToTop";
import { Desktop } from "./screens/Desktop";
import { AiForBusiness } from "./screens/AiForBusiness";
import { Blog } from "./screens/Blog";
import { DataForAi } from "./screens/DataForAi";
import { Carreer } from "./screens/Carreer";
import { InfrastructureFor } from "./screens/InfrastructureFor";

export const App = () => {
  return (
    <Router>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Desktop />} />
        <Route path="/ai-for-business" element={<AiForBusiness />} />
        <Route path="/blog" element={<Blog />} />
        <Route path="/data-for-ai" element={<DataForAi />} />
        <Route path="/career" element={<Carreer />} />
        <Route path="/infrastructure-for-ai" element={<InfrastructureFor />} />
      </Routes>
    </Router>
  );
};
