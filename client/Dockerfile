# Serves the prebuilt client. Build it first on the host:  npm install && npm run build
# (Building inside the image would repeat the npm install; the static files are all it needs.)
FROM node:20-alpine
WORKDIR /app
COPY dist/client/browser ./public
COPY server.js .
EXPOSE 4201
CMD ["node", "server.js"]
