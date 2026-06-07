FROM node:18-alpine

WORKDIR /usr/src/app

COPY package*.json ./

# Install all deps (incl. the prisma CLI devDependency) so `prisma migrate deploy`
# and `prisma generate` work at build and runtime.
RUN npm install

COPY . .

RUN npx prisma generate

EXPOSE 3088

CMD [ "node", "src/server.js" ]
