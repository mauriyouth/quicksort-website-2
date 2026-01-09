import { BlogPostsGridSection } from "./sections/BlogPostsGridSection";
import { FooterInfoSection } from "./sections/FooterInfoSection";
import { MainNavigationSection } from "../../components/MainNavigationSection";
import { PageHeaderSection } from "./sections/PageHeaderSection";

export const Blog = (): JSX.Element => {
  return (
    <main className="flex flex-col w-full items-center relative bg-[#141414]">
      <img
        className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-[1440px] h-[722px] pointer-events-none"
        alt="Background pattern"
        src="/background-pattern.svg"
      />

      <MainNavigationSection />
      <PageHeaderSection />
      <BlogPostsGridSection />
      <FooterInfoSection />
    </main>
  );
};
