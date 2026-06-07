const express = require('express')
const path    = require('path')
const db      = require('./db')

const app = express()

app.use(express.json({ limit: '50mb' }))

app.use('/api/normas',      require('./routes/normas'))
app.use('/api/publicacoes', require('./routes/publicacoes'))
app.use('/api/exportar',    require('./routes/exportar'))
app.use('/api/tags',        require('./routes/tags'))
app.use('/api/excecoes',    require('./routes/excecoes'))

// Serve built frontend
const staticDir = path.join(__dirname, '..', 'out', 'renderer')
app.use(express.static(staticDir))
app.get('*', (req, res) => res.sendFile(path.join(staticDir, 'index.html')))

const PORT = process.env.PORT || 3000

db.init()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Legislator rodando em http://localhost:${PORT}`)
      console.log(`Acesso na rede: http://<IP-deste-PC>:${PORT}`)
      console.log(`Banco: ${db.dbPath}`)
    })
  })
  .catch(err => {
    console.error('Erro ao iniciar banco de dados:', err)
    process.exit(1)
  })
