import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import react from "@astrojs/react";
import icon from "astro-icon";

import tailwind from "@astrojs/tailwind";

// https://astro.build/config
export default defineConfig({
  server: {
    // 服务器主机名，如果允许外部访问，可设置为 "0.0.0.0"
    host: "0.0.0.0",
    port: 3005,
    open: true,
  },
  integrations: [
    tailwind({
      applyBaseStyles: false,
    }),
    starlight({
      title: "前端doc",
      logo: { src: "./src/assets/favicon.svg" },

      components: {
        // 重写默认的 `SocialIcons` 组件。
        SocialIcons: "./src/components/TopRightIcon.astro",
      },
      social: {
        github: "https://github.com/gjxwxt",
      },
      customCss: [
        // 你的自定义 CSS 文件的相对路径
      ],
      sidebar: [
        {
          label: "React",
          items: [
            // Each item here is one entry in the navigation menu.
            {
              label: "学习路线",
              link: "/learn/react-learn/",
            },
            {
              label: "组件库",
              link: "/learn/react-ui/",
            },
          ],
        },
        {
          label: "guides",
          autogenerate: {
            directory: "guides",
          },
        },
        {
          label: "tools",
          autogenerate: {
            directory: "tools",
          },
        },
      ],
    }),
    react(),
    icon(),
    tailwind(),
  ],
});
